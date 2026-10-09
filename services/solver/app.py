"""Local FastAPI wrapper around the solver.

    POST /risk      RiskRequest        -> RiskResult
    POST /solve     SolveRequest       -> SolveResult
    POST /compare   CompareRequest     -> CompareResult
    POST /timing    TimingCheckRequest -> TimingCheckResult

Run: uvicorn --factory services.solver.app:create_app --port 8002
"""

from __future__ import annotations

from fastapi import FastAPI

from services.solver.mip import check_timing, compare, solve
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
from services.solver.risk import assess


def create_app() -> FastAPI:
    app = FastAPI(title="SIAGA solver", version="0.1.0")

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/risk")
    def risk(req: RiskRequest) -> RiskResult:
        return assess(req)

    @app.post("/solve")
    def solve_(req: SolveRequest) -> SolveResult:
        return solve(req)

    @app.post("/compare")
    def compare_(req: CompareRequest) -> CompareResult:
        return compare(req)

    @app.post("/timing")
    def timing(req: TimingCheckRequest) -> TimingCheckResult:
        return check_timing(req)

    return app
