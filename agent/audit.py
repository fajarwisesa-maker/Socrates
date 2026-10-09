"""Append-only, hash-chained audit trail per case.

Each entry: {case_id, seq, ts, kind, payload, prev_hash, hash} where
hash = sha256(canonical JSON of the entry without `hash`) and prev_hash is the previous
entry's hash ("0"*64 for the first). Editing, deleting or reordering any entry breaks
the chain, which `verify()` detects.

`AuditWriter` is the seam for Phase 7 (S3 with Object Lock). Kinds used:
stage_transition, tool_call, policy_decision, approval, case.
"""

from __future__ import annotations

import hashlib
import json
import threading
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

from pydantic import BaseModel

from siaga_common.timeline import to_iso

GENESIS = "0" * 64


class AuditEntry(BaseModel):
    case_id: str
    seq: int
    ts: str
    kind: str
    payload: dict[str, Any]
    prev_hash: str
    hash: str


class AuditVerification(BaseModel):
    ok: bool
    entries: int
    broken_at: int | None = None
    reason: str | None = None


def _digest(fields: dict[str, Any]) -> str:
    canonical = json.dumps(fields, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode()).hexdigest()


def verify_entries(entries: list[dict[str, Any]]) -> AuditVerification:
    prev = GENESIS
    for i, e in enumerate(entries):
        body = {k: v for k, v in e.items() if k != "hash"}
        if e.get("seq") != i:
            return AuditVerification(ok=False, entries=len(entries), broken_at=i, reason="seq")
        if e.get("prev_hash") != prev:
            return AuditVerification(
                ok=False, entries=len(entries), broken_at=i, reason="prev_hash mismatch"
            )
        if _digest(body) != e.get("hash"):
            return AuditVerification(
                ok=False, entries=len(entries), broken_at=i, reason="hash mismatch"
            )
        prev = e["hash"]
    return AuditVerification(ok=True, entries=len(entries))


class AuditWriter(Protocol):
    def append(self, case_id: str, kind: str, payload: dict[str, Any]) -> AuditEntry: ...
    def read(self, case_id: str) -> list[AuditEntry]: ...
    def verify(self, case_id: str) -> AuditVerification: ...


class LocalAuditWriter:
    """One JSONL file per case under `audit_dir`, opened in append mode only."""

    def __init__(self, audit_dir: Path, clock: Callable[[], datetime] | None = None):
        self.dir = Path(audit_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.clock = clock or (lambda: datetime.now(UTC))
        self._lock = threading.Lock()
        self._tail: dict[str, tuple[int, str]] = {}

    def _path(self, case_id: str) -> Path:
        if not case_id.replace("-", "").replace("_", "").isalnum():
            raise ValueError(f"bad case id {case_id!r}")
        return self.dir / f"{case_id}.jsonl"

    def _raw(self, case_id: str) -> list[dict[str, Any]]:
        path = self._path(case_id)
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]

    def append(self, case_id: str, kind: str, payload: dict[str, Any]) -> AuditEntry:
        with self._lock:
            if case_id not in self._tail:
                raw = self._raw(case_id)
                self._tail[case_id] = (len(raw), raw[-1]["hash"] if raw else GENESIS)
            seq, prev = self._tail[case_id]
            body = {
                "case_id": case_id,
                "seq": seq,
                "ts": to_iso(self.clock()),
                "kind": kind,
                "payload": json.loads(json.dumps(payload, default=str)),
                "prev_hash": prev,
            }
            entry = AuditEntry(**body, hash=_digest(body))
            with self._path(case_id).open("a") as f:
                f.write(entry.model_dump_json() + "\n")
            self._tail[case_id] = (seq + 1, entry.hash)
            return entry

    def read(self, case_id: str) -> list[AuditEntry]:
        return [AuditEntry(**e) for e in self._raw(case_id)]

    def verify(self, case_id: str) -> AuditVerification:
        return verify_entries(self._raw(case_id))
