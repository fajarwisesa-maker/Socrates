"""Structured LLM outputs, each exposed to the model as a tool (Converse toolSpec)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from services.solver.models import Strategy

Cause = Literal[
    "flood", "landslide", "road_closure", "accident", "vehicle_breakdown", "port_strike",
    "labor_strike", "weather", "carrier_capacity", "quality_hold", "other", "none",
]  # fmt: skip
Lane = Literal["SMG-JKT", "BDG-CKR", "SBY-JKT", "TPR-CKR", "MRK-BKS"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Disruption(_Strict):
    """PERCEIVE output: one fused disruption from all signals."""

    is_disruption: bool
    cause: Cause
    lane: Lane | None = Field(description="affected transport lane, null if unknown / none")
    location: str | None
    delay_hours_min: float | None = Field(None, ge=0)
    delay_hours_max: float | None = Field(None, ge=0)
    references: list[str] = Field(description="document numbers (PO/SO/shipment), not SKUs")
    confidence: float = Field(ge=0, le=1)
    evidence_quotes: list[str] = Field(description="short verbatim quotes from the signals")

    @field_validator("delay_hours_max")
    @classmethod
    def _range(cls, v, info):
        lo = info.data.get("delay_hours_min")
        if v is not None and lo is not None and v < lo:
            raise ValueError("delay_hours_max < delay_hours_min")
        return v


class Candidate(_Strict):
    label: str = Field(description="short name, e.g. 'Air charter'")
    strategies: list[Strategy] = Field(min_length=1)
    rationale: str

    @field_validator("strategies")
    @classmethod
    def _unique(cls, v):
        return sorted(set(v), key=v.index)


class CandidatePlan(_Strict):
    """PLAN output: strategy combinations to simulate (no numbers)."""

    candidates: list[Candidate] = Field(min_length=1, max_length=3)
    precedent_ids: list[str] = []


class RejectedOption(_Strict):
    option_id: str
    why: str


class Explanation(_Strict):
    """REFLECT output: the planner-facing explanation of deterministic results."""

    summary: str
    recommendation_rationale: str
    rejected_options: list[RejectedOption] = []
    risks: list[str] = []


def tool_spec(name: str, description: str, model: type[BaseModel]) -> dict[str, Any]:
    return {
        "toolSpec": {
            "name": name,
            "description": description,
            "inputSchema": {"json": model.model_json_schema()},
        }
    }


REPORT_DISRUPTION = tool_spec(
    "report_disruption", "Report the structured disruption fused from all signals.", Disruption
)
PROPOSE_CANDIDATES = tool_spec(
    "propose_candidates", "Propose 1-3 strategy combinations to simulate.", CandidatePlan
)
WRITE_EXPLANATION = tool_spec(
    "write_explanation", "Write the planner-facing explanation of the options.", Explanation
)
