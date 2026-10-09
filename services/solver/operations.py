"""Single dispatch table shared by the FastAPI wrapper and the Lambda handler."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from pydantic import BaseModel

from services.solver.mip import check_timing, compare, solve
from services.solver.models import (
    CompareRequest,
    RiskRequest,
    SolveRequest,
    TimingCheckRequest,
)
from services.solver.risk import assess

OPERATIONS: dict[str, tuple[type[BaseModel], Callable[[Any], BaseModel]]] = {
    "risk": (RiskRequest, assess),
    "solve": (SolveRequest, solve),
    "compare": (CompareRequest, compare),
    "timing": (TimingCheckRequest, check_timing),
}


def run(operation: str, payload: dict[str, Any]) -> dict[str, Any]:
    if operation not in OPERATIONS:
        raise KeyError(f"unknown operation {operation!r}; expected one of {sorted(OPERATIONS)}")
    model, fn = OPERATIONS[operation]
    return fn(model.model_validate(payload)).model_dump(mode="json")
