"""Append-only, hash-chained audit trail per case.

Each entry: {case_id, seq, ts, kind, payload, prev_hash, hash} where
hash = sha256(canonical JSON of the entry without `hash`) and prev_hash is the previous
entry's hash ("0"*64 for the first). Editing, deleting or reordering any entry breaks
the chain, which `verify()` detects.

`AuditWriter` is the seam; `S3AuditWriter` (AUDIT_BACKEND=s3) keeps the local file and also
stores every entry in S3 with Object Lock. Kinds used: stage_transition, tool_call,
policy_decision, approval, case, and more (see the dashboard's audit view).
"""

from __future__ import annotations

import hashlib
import json
import logging
import queue
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

from pydantic import BaseModel

from siaga_common.timeline import to_iso

GENESIS = "0" * 64
log = logging.getLogger("siaga.audit")


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
        return [
            json.loads(line)
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]

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
            with self._path(case_id).open("a", encoding="utf-8") as f:
                f.write(entry.model_dump_json() + "\n")
            self._tail[case_id] = (seq + 1, entry.hash)
            return entry

    def read(self, case_id: str) -> list[AuditEntry]:
        return [AuditEntry(**e) for e in self._raw(case_id)]

    def verify(self, case_id: str) -> AuditVerification:
        return verify_entries(self._raw(case_id))


class S3AuditWriter:
    """AUDIT_BACKEND=s3: the local JSONL stays the working copy (the dashboard reads it, a
    case never waits on the network), and every entry is also PUT to S3 as its own object,
    `{prefix}{case_id}/{seq:06d}.json`, by one background thread in order.

    The bucket is created with Object Lock and a default retention in governance mode
    (`make aws-setup`), so S3 itself refuses to overwrite or delete a stored entry until
    the retention ends. The hash chain is the same, so `verify_remote()` can check a case
    from S3 alone and compare it with the local copy. A failed upload is retried with
    backoff and never affects the case; `sync()` uploads whatever is missing (`make
    audit-sync`), e.g. after the laptop was offline.
    """

    def __init__(
        self,
        local: LocalAuditWriter,
        bucket: str,
        prefix: str = "audit/",
        client: Any = None,
        region: str | None = None,
        retry_delays: tuple[float, ...] = (0.5, 1.0, 2.0, 5.0, 10.0),
    ):
        self.local = local
        self.bucket = bucket
        self.prefix = prefix if prefix.endswith("/") or not prefix else prefix + "/"
        self._client = client
        self.region = region
        self.retry_delays = retry_delays
        self._queue: queue.Queue[AuditEntry] = queue.Queue()
        self._stats: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()
        self._worker: threading.Thread | None = None

    @property
    def client(self) -> Any:
        if self._client is None:
            import boto3

            self._client = boto3.client("s3", region_name=self.region)
        return self._client

    def key(self, case_id: str, seq: int) -> str:
        return f"{self.prefix}{case_id}/{seq:06d}.json"

    # --- the AuditWriter protocol: writes go to both, reads come from the local copy ---
    def append(self, case_id: str, kind: str, payload: dict[str, Any]) -> AuditEntry:
        entry = self.local.append(case_id, kind, payload)
        with self._lock:
            st = self._stats.setdefault(case_id, {"stored": 0, "pending": 0, "last_error": None})
            st["pending"] += 1
            if self._worker is None or not self._worker.is_alive():
                self._worker = threading.Thread(target=self._run, name="s3-audit", daemon=True)
                self._worker.start()
        self._queue.put(entry)
        return entry

    def read(self, case_id: str) -> list[AuditEntry]:
        return self.local.read(case_id)

    def verify(self, case_id: str) -> AuditVerification:
        return self.local.verify(case_id)

    # --- S3 ---
    def _put(self, entry: AuditEntry) -> None:
        # A checksum is required on PUTs to an Object Lock bucket (Content-MD5 or a flexible
        # checksum); the bucket's default retention locks the object.
        self.client.put_object(
            Bucket=self.bucket,
            Key=self.key(entry.case_id, entry.seq),
            Body=entry.model_dump_json().encode("utf-8"),
            ContentType="application/json",
            ChecksumAlgorithm="SHA256",
            Metadata={"siaga-hash": entry.hash, "siaga-prev-hash": entry.prev_hash},
        )

    def _run(self) -> None:
        import time

        while True:
            entry = self._queue.get()
            for attempt, delay in enumerate((0.0, *self.retry_delays)):
                if delay:
                    time.sleep(delay)
                try:
                    self._put(entry)
                except Exception as e:  # noqa: BLE001 - never reaches the case
                    err = f"{type(e).__name__}: {str(e)[:200]}"
                    with self._lock:
                        self._stats[entry.case_id]["last_error"] = err
                    if attempt == len(self.retry_delays):
                        log.warning("audit %s #%s not stored in S3 (%s); make audit-sync "
                                    "uploads it later", entry.case_id, entry.seq, err)  # fmt: skip
                        with self._lock:
                            self._stats[entry.case_id]["pending"] -= 1
                            self._stats[entry.case_id]["failed"] = (
                                self._stats[entry.case_id].get("failed", 0) + 1
                            )
                    continue
                with self._lock:
                    st = self._stats[entry.case_id]
                    st["stored"] += 1
                    st["pending"] -= 1
                    st["last_error"] = None
                break
            self._queue.task_done()

    def flush(self, timeout: float = 30.0) -> bool:
        """Wait until every queued entry was tried (tests, scripts)."""
        import time

        deadline = time.monotonic() + timeout
        while self._queue.unfinished_tasks and time.monotonic() < deadline:
            time.sleep(0.02)
        return not self._queue.unfinished_tasks

    def storage(self, case_id: str) -> dict[str, Any]:
        """What this process stored for the case (cheap; for the dashboard)."""
        with self._lock:
            st = dict(self._stats.get(case_id) or {"stored": 0, "pending": 0, "last_error": None})
        return {"backend": "s3", "bucket": self.bucket, "prefix": f"{self.prefix}{case_id}/"} | st

    def _remote_keys(self, case_id: str) -> list[str]:
        keys: list[str] = []
        paginator = self.client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=f"{self.prefix}{case_id}/"):
            keys += [o["Key"] for o in page.get("Contents", [])]
        return sorted(keys)

    def verify_remote(self, case_id: str) -> dict[str, Any]:
        """Read the case back from S3 only, check its hash chain, compare with the local
        copy, and read the Object Lock retention of the last entry."""
        keys = self._remote_keys(case_id)

        def get(key: str) -> dict[str, Any]:
            body = self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()
            return json.loads(body)

        with ThreadPoolExecutor(max_workers=8) as pool:
            remote = list(pool.map(get, keys))
        check = verify_entries(remote)
        local = [e.model_dump(mode="json") for e in self.local.read(case_id)]
        lock: dict[str, Any] | None = None
        if keys:
            head = self.client.head_object(Bucket=self.bucket, Key=keys[-1])
            until = head.get("ObjectLockRetainUntilDate")
            lock = {
                "mode": head.get("ObjectLockMode"),
                "retain_until": until.isoformat() if hasattr(until, "isoformat") else until,
            }
        return {
            "bucket": self.bucket,
            "prefix": f"{self.prefix}{case_id}/",
            "entries": len(remote),
            "local_entries": len(local),
            "chain": check.model_dump(),
            # whole entries, not only their hash fields (an edited payload keeps its old hash)
            "matches_local": remote == local,
            "object_lock": lock,
        }

    def sync(self, case_id: str) -> int:
        """Upload local entries missing in S3 (never overwrites). Returns how many."""
        have = set(self._remote_keys(case_id))
        missing = [e for e in self.local.read(case_id) if self.key(case_id, e.seq) not in have]
        for e in missing:
            self._put(e)
        return len(missing)

    def case_ids(self) -> list[str]:
        return sorted(p.stem for p in self.local.dir.glob("*.jsonl"))
