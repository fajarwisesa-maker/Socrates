"""Clients for the mock S/4HANA and the solver, behind small interfaces.

SAP: HTTP (OData) against SAP_MOCK_URL - the same code talks to API Gateway in Phase 7.
Solver: in-process (default), HTTP (SOLVER_URL) or Lambda (Phase 7), via SOLVER_BACKEND.
"""

from __future__ import annotations

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
    def __init__(self, base_url: str | None = None, client: httpx.Client | None = None):
        self.http = client or httpx.Client(base_url=base_url or "", timeout=10)

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
