"""Clients for the mock S/4HANA and the solver, behind small interfaces.

SAP: HTTP (OData) against SAP_MOCK_URL - the same code talks to API Gateway in Phase 7.
Solver: in-process (default), HTTP (SOLVER_URL) or AWS Lambda (SOLVER_LAMBDA_NAME), via
SOLVER_BACKEND.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from typing import Any, Protocol

import httpx

from services.solver import mip, risk
from services.solver.models import (
    CompareRequest,
    CompareResult,
    RiskRequest,
    RiskResult,
    SolveRequest,
    SolveResult,
    TimingCheckRequest,
    TimingCheckResult,
)

Row = dict[str, Any]
log = logging.getLogger("siaga.solver")


class SapError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(f"{code}: {message}")
        self.status, self.code, self.message = status, code, message


class SapClient(Protocol):
    def query(
        self,
        entity_set: str,
        *,
        filter: str | None = None,
        select: str | None = None,
        top: int | None = None,
        orderby: str | None = None,
    ) -> list[Row]: ...
    def get(self, entity_set: str, key: str) -> Row: ...
    def post(self, path: str, body: dict[str, Any]) -> Row: ...


def odata_key(*parts: str, **named: str) -> str:
    """odata_key('4500018231') -> "'4500018231'"; odata_key(Material='MG-2L', Plant='X')."""
    q = lambda v: "'" + str(v).replace("'", "''") + "'"  # noqa: E731
    if named:
        return ",".join(f"{k}={q(v)}" for k, v in named.items())
    return ",".join(q(p) for p in parts)


class HttpSapClient:
    def __init__(
        self,
        base_url: str | None = None,
        client: httpx.Client | None = None,
        headers: dict[str, str] | None = None,
        transport: httpx.BaseTransport | None = None,
    ):
        # headers: X-API-Key for the BTP-hosted mock (v2 step 1)
        self.http = client or httpx.Client(
            base_url=base_url or "", timeout=10, headers=headers, transport=transport
        )

    def _check(self, r: httpx.Response) -> Row:
        body = r.json()
        if r.status_code >= 400:
            err = body.get("error", {}) if isinstance(body, dict) else {}
            raise SapError(r.status_code, err.get("code", "HTTP"), err.get("message", r.text))
        body.pop("@odata.context", None)
        return body

    def query(self, entity_set, *, filter=None, select=None, top=None, orderby=None):
        params = {
            k: v
            for k, v in {
                "$filter": filter,
                "$select": select,
                "$top": top,
                "$orderby": orderby,
            }.items()
            if v is not None
        }
        return self._check(self.http.get(f"/{entity_set}", params=params))["value"]

    def get(self, entity_set: str, key: str) -> Row:
        return self._check(self.http.get(f"/{entity_set}({key})"))

    def post(self, path: str, body: dict[str, Any]) -> Row:
        return self._check(self.http.post(path, json=body))

    def day0(self) -> str | None:
        """Mock-SAP only: the demo's day 0 (display anchor for the timeline)."""
        return self._check(self.http.get("/admin/state")).get("day0")


class SolverClient(Protocol):
    def risk(self, req: RiskRequest) -> RiskResult: ...
    def solve(self, req: SolveRequest) -> SolveResult: ...
    def compare(self, req: CompareRequest) -> CompareResult: ...
    def timing(self, req: TimingCheckRequest) -> TimingCheckResult: ...


class InProcessSolver:
    def risk(self, req: RiskRequest) -> RiskResult:
        return risk.assess(req)

    def solve(self, req: SolveRequest) -> SolveResult:
        return mip.solve(req)

    def compare(self, req: CompareRequest) -> CompareResult:
        return mip.compare(req)

    def timing(self, req: TimingCheckRequest) -> TimingCheckResult:
        return mip.check_timing(req)


class HttpSolver:
    def __init__(self, base_url: str | None = None, client: httpx.Client | None = None):
        self.http = client or httpx.Client(base_url=base_url or "", timeout=30)

    def _post(self, path: str, req, out):
        r = self.http.post(path, json=req.model_dump(mode="json"))
        r.raise_for_status()
        return out.model_validate(r.json())

    def risk(self, req: RiskRequest) -> RiskResult:
        return self._post("/risk", req, RiskResult)

    def solve(self, req: SolveRequest) -> SolveResult:
        return self._post("/solve", req, SolveResult)

    def compare(self, req: CompareRequest) -> CompareResult:
        return self._post("/compare", req, CompareResult)

    def timing(self, req: TimingCheckRequest) -> TimingCheckResult:
        return self._post("/timing", req, TimingCheckResult)


class SolverBackendError(RuntimeError):
    pass


class LambdaSolver:
    """SOLVER_BACKEND=lambda: every solver call is a synchronous invoke of the Lambda function
    built from services/solver (`make aws-setup`), with the event the handler already
    accepts: {"operation": "risk|solve|compare|timing", "payload": {...}}.

    If AWS fails (no credentials, throttling, timeout, a function error) and the fallback is
    on, the same call runs in process, so a demo never stops on the network. Each call
    records where it ran; the tool registry copies that into the tool call
    (`computed_on`), so the dashboard and the audit trail say "AWS Lambda" only when it was.
    """

    def __init__(
        self,
        function_name: str,
        client: Any = None,
        region: str | None = None,
        fallback: InProcessSolver | None = None,
    ):
        self.function_name = function_name
        self._client = client
        self.region = region
        self.fallback = fallback
        self._local = threading.local()
        self._lock = threading.Lock()
        self.stats: dict[str, Any] = {"lambda": 0, "fallback": 0, "last_ms": None,
                                      "last_error": None}  # fmt: skip

    @property
    def client(self) -> Any:
        if self._client is None:
            import boto3
            from botocore.config import Config

            cfg = Config(connect_timeout=5, read_timeout=30,
                         retries={"max_attempts": 2, "mode": "standard"})  # fmt: skip
            self._client = boto3.client("lambda", region_name=self.region, config=cfg)
        return self._client

    # --- where the calls of one tool ran (per thread) ---
    def begin(self) -> None:
        self._local.used = []

    def used(self) -> list[str]:
        return list(getattr(self._local, "used", []))

    def _mark(self, where: str) -> None:
        if not hasattr(self._local, "used"):
            self._local.used = []
        self._local.used.append(where)

    def invoke(self, operation: str, payload: dict[str, Any]) -> dict[str, Any]:
        """One raw invoke; raises SolverBackendError on any AWS or function problem."""
        t0 = time.perf_counter()
        try:
            r = self.client.invoke(
                FunctionName=self.function_name,
                InvocationType="RequestResponse",
                Payload=json.dumps({"operation": operation, "payload": payload}).encode(),
            )
            body = json.loads(r["Payload"].read() or b"null")
        except Exception as e:  # noqa: BLE001 - botocore errors, timeouts, bad JSON
            raise SolverBackendError(f"{type(e).__name__}: {str(e)[:300]}") from e
        if r.get("FunctionError"):
            msg = body.get("errorMessage") if isinstance(body, dict) else body
            raise SolverBackendError(f"function error: {str(msg)[:300]}")
        if isinstance(body, dict) and "error" in body and len(body) == 1:
            raise SolverBackendError(f"solver refused the request: {body['error']}")
        with self._lock:
            self.stats["last_ms"] = round((time.perf_counter() - t0) * 1000, 1)
        return body

    def _call(self, operation: str, req, out):
        try:
            result = out.model_validate(self.invoke(operation, req.model_dump(mode="json")))
        except SolverBackendError as e:
            with self._lock:
                self.stats["last_error"] = str(e)
            if self.fallback is None:
                raise
            log.warning("solver %s ran in process: Lambda failed (%s)", operation, e)
            with self._lock:
                self.stats["fallback"] += 1
            self._mark("in_process_fallback")
            return getattr(self.fallback, operation)(req)
        with self._lock:
            self.stats["lambda"] += 1
            self.stats["last_error"] = None
        self._mark("aws_lambda")
        return result

    def risk(self, req: RiskRequest) -> RiskResult:
        return self._call("risk", req, RiskResult)

    def solve(self, req: SolveRequest) -> SolveResult:
        return self._call("solve", req, SolveResult)

    def compare(self, req: CompareRequest) -> CompareResult:
        return self._call("compare", req, CompareResult)

    def timing(self, req: TimingCheckRequest) -> TimingCheckResult:
        return self._call("timing", req, TimingCheckResult)

    def ping(self) -> dict[str, Any]:
        """A tiny CBC solve on Lambda (no fallback): proves the function and its solver run."""
        return self.invoke("ping", {})
