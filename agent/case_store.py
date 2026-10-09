"""Case working memory, stage events and approval requests.

`CaseStore` is the seam for Phase 7 (DynamoDB). The SQLite implementation keeps the case
record as one JSON document (like a DynamoDB item), events as rows keyed by
(case_id, seq), and approvals as JSON documents.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal, Protocol

from pydantic import BaseModel, Field

from siaga_common.timeline import to_iso

CaseStatus = Literal[
    "OPEN", "RUNNING", "AWAITING_APPROVAL", "VERIFYING", "RESOLVED", "ESCALATED", "FAILED"
]
Stage = Literal["PERCEIVE", "ASSESS", "PLAN", "SIMULATE", "REFLECT", "ACT", "VERIFY", "CASE"]
ApprovalStatus = Literal["PENDING", "APPROVED", "REJECTED", "EXPIRED"]


class CaseRecord(BaseModel):
    """One record per case: the agent's working memory (brief §3)."""

    case_id: str
    status: CaseStatus = "OPEN"
    created_at: str
    updated_at: str
    day0: str | None = None
    signals: list[dict[str, Any]] = []
    disruption: dict[str, Any] | None = None
    affected: dict[str, Any] | None = None
    risk: dict[str, Any] | None = None
    candidates: list[dict[str, Any]] = []
    solver_results: list[dict[str, Any]] = []
    critic_findings: list[dict[str, Any]] = []
    actions: list[dict[str, Any]] = []
    approvals: list[str] = []
    notes: list[dict[str, Any]] = []
    tool_call_count: int = 0
    replan_count: int = 0
    stage_timestamps: dict[str, dict[str, str]] = {}
    escalation_reason: str | None = None


class CaseEvent(BaseModel):
    case_id: str
    seq: int
    stage: Stage
    status: str
    title: str
    detail: str = ""
    data: dict[str, Any] = {}
    ts: str


class ApprovalRequest(BaseModel):
    """A Tier 3 action waiting for a human. Bound to exact tool + arguments."""

    approval_id: str
    case_id: str
    tool: str
    args: dict[str, Any]
    args_hash: str
    status: ApprovalStatus = "PENDING"
    card: dict[str, Any] = Field(
        default={}, description="what, why, cost, alternatives, if_rejected, approve_by"
    )
    created_at: str
    decided_at: str | None = None
    decided_by: str | None = None
    reason: str | None = None


def args_hash(tool: str, args: dict[str, Any]) -> str:
    canonical = json.dumps({"tool": tool, "args": args}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


class CaseStore(Protocol):
    def create_case(self, **fields: Any) -> CaseRecord: ...
    def get_case(self, case_id: str) -> CaseRecord: ...
    def update_case(self, case_id: str, **fields: Any) -> CaseRecord: ...
    def increment_tool_calls(self, case_id: str) -> int: ...
    def append_event(
        self,
        case_id: str,
        stage: Stage,
        status: str,
        title: str,
        detail: str = "",
        data: dict[str, Any] | None = None,
    ) -> CaseEvent: ...
    def list_events(self, case_id: str, after: int = -1) -> list[CaseEvent]: ...
    def create_approval(
        self, case_id: str, tool: str, args: dict[str, Any], card: dict[str, Any]
    ) -> ApprovalRequest: ...
    def get_approval(self, approval_id: str) -> ApprovalRequest: ...
    def list_approvals(self, case_id: str) -> list[ApprovalRequest]: ...
    def decide_approval(
        self, approval_id: str, approve: bool, by: str, reason: str | None = None
    ) -> ApprovalRequest: ...
    def find_valid_approval(
        self, case_id: str, tool: str, args: dict[str, Any]
    ) -> ApprovalRequest | None: ...


class NotFound(KeyError):
    pass


class SqliteCaseStore:
    def __init__(self, path: Path | str, clock: Callable[[], datetime] | None = None):
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.clock = clock or (lambda: datetime.now(UTC))
        self._conn = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self._lock = threading.RLock()
        self._conn.executescript(
            """
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS cases (case_id TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS events (
                case_id TEXT NOT NULL, seq INTEGER NOT NULL, data TEXT NOT NULL,
                PRIMARY KEY (case_id, seq));
            CREATE TABLE IF NOT EXISTS approvals (
                approval_id TEXT PRIMARY KEY, case_id TEXT NOT NULL, data TEXT NOT NULL);
            """
        )

    def _now(self) -> str:
        return to_iso(self.clock())

    # ---- cases ----

    def create_case(self, **fields: Any) -> CaseRecord:
        now = self._now()
        case = CaseRecord(
            case_id=fields.pop("case_id", None) or f"case-{uuid.uuid4().hex[:10]}",
            created_at=now,
            updated_at=now,
            **fields,
        )
        with self._lock:
            self._conn.execute(
                "INSERT INTO cases VALUES (?, ?)", (case.case_id, case.model_dump_json())
            )
        return case

    def get_case(self, case_id: str) -> CaseRecord:
        with self._lock:
            hit = self._conn.execute(
                "SELECT data FROM cases WHERE case_id = ?", (case_id,)
            ).fetchone()
        if not hit:
            raise NotFound(case_id)
        return CaseRecord.model_validate_json(hit[0])

    def update_case(self, case_id: str, **fields: Any) -> CaseRecord:
        with self._lock:
            case = self.get_case(case_id)
            updated = case.model_copy(update={**fields, "updated_at": self._now()})
            CaseRecord.model_validate(updated.model_dump())  # validate the merged record
            self._conn.execute(
                "UPDATE cases SET data = ? WHERE case_id = ?",
                (updated.model_dump_json(), case_id),
            )
            return updated

    def increment_tool_calls(self, case_id: str) -> int:
        with self._lock:
            n = self.get_case(case_id).tool_call_count + 1
            self.update_case(case_id, tool_call_count=n)
            return n

    # ---- events ----

    def append_event(
        self,
        case_id: str,
        stage: Stage,
        status: str,
        title: str,
        detail: str = "",
        data: dict[str, Any] | None = None,
    ) -> CaseEvent:
        with self._lock:
            (n,) = self._conn.execute(
                "SELECT COUNT(*) FROM events WHERE case_id = ?", (case_id,)
            ).fetchone()
            event = CaseEvent(
                case_id=case_id,
                seq=n,
                stage=stage,
                status=status,
                title=title,
                detail=detail,
                data=json.loads(json.dumps(data or {}, default=str)),
                ts=self._now(),
            )
            self._conn.execute(
                "INSERT INTO events VALUES (?, ?, ?)", (case_id, n, event.model_dump_json())
            )
            return event

    def list_events(self, case_id: str, after: int = -1) -> list[CaseEvent]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT data FROM events WHERE case_id = ? AND seq > ? ORDER BY seq",
                (case_id, after),
            ).fetchall()
        return [CaseEvent.model_validate_json(d) for (d,) in rows]

    # ---- approvals ----

    def _put_approval(self, a: ApprovalRequest) -> None:
        self._conn.execute(
            "INSERT OR REPLACE INTO approvals VALUES (?, ?, ?)",
            (a.approval_id, a.case_id, a.model_dump_json()),
        )

    def create_approval(
        self, case_id: str, tool: str, args: dict[str, Any], card: dict[str, Any]
    ) -> ApprovalRequest:
        a = ApprovalRequest(
            approval_id=f"apr-{uuid.uuid4().hex[:10]}",
            case_id=case_id,
            tool=tool,
            args=args,
            args_hash=args_hash(tool, args),
            card=card,
            created_at=self._now(),
        )
        with self._lock:
            self._put_approval(a)
            case = self.get_case(case_id)
            self.update_case(case_id, approvals=[*case.approvals, a.approval_id])
        return a

    def get_approval(self, approval_id: str) -> ApprovalRequest:
        with self._lock:
            hit = self._conn.execute(
                "SELECT data FROM approvals WHERE approval_id = ?", (approval_id,)
            ).fetchone()
        if not hit:
            raise NotFound(approval_id)
        return ApprovalRequest.model_validate_json(hit[0])

    def list_approvals(self, case_id: str) -> list[ApprovalRequest]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT data FROM approvals WHERE case_id = ?", (case_id,)
            ).fetchall()
        return sorted(
            (ApprovalRequest.model_validate_json(d) for (d,) in rows), key=lambda a: a.created_at
        )

    def decide_approval(
        self, approval_id: str, approve: bool, by: str, reason: str | None = None
    ) -> ApprovalRequest:
        with self._lock:
            a = self.get_approval(approval_id)
            if a.status != "PENDING":
                raise ValueError(f"approval {approval_id} is already {a.status}")
            a = a.model_copy(
                update={
                    "status": "APPROVED" if approve else "REJECTED",
                    "decided_at": self._now(),
                    "decided_by": by,
                    "reason": reason,
                }
            )
            self._put_approval(a)
            return a

    def find_valid_approval(
        self, case_id: str, tool: str, args: dict[str, Any]
    ) -> ApprovalRequest | None:
        h = args_hash(tool, args)
        return next(
            (
                a
                for a in self.list_approvals(case_id)
                if a.status == "APPROVED" and a.tool == tool and a.args_hash == h
            ),
            None,
        )

    def reset(self) -> None:
        with self._lock:
            self._conn.executescript(
                "DELETE FROM cases; DELETE FROM events; DELETE FROM approvals;"
            )
