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


EvidenceField = Literal["is_disruption", "cause", "location", "lane", "delay", "references"]


class EvidenceItem(_Strict):
    quote: str = Field(description="verbatim phrase copied from the signal, slang and typos kept")
    signal: int = Field(ge=1, description="number of the signal the quote comes from")
    field: EvidenceField = Field(description="the disruption field this quote supports")


class _DisruptionFields(BaseModel):
    is_disruption: bool
    cause: Cause
    lane: Lane | None = Field(description="affected transport lane, null if unknown / none")
    location: str | None
    delay_hours_min: float | None = Field(None, ge=0)
    delay_hours_max: float | None = Field(None, ge=0)
    references: list[str] = Field(description="document numbers (PO/SO/shipment), not SKUs")

    @field_validator("delay_hours_max")
    @classmethod
    def _range(cls, v, info):
        lo = info.data.get("delay_hours_min")
        if v is not None and lo is not None and v < lo:
            raise ValueError("delay_hours_max < delay_hours_min")
        return v


class Disruption(_DisruptionFields):
    """PERCEIVE output from the model: one fused disruption from all signals."""

    model_config = ConfigDict(extra="forbid")

    evidence: list[EvidenceItem] = Field(
        description="quotes supporting the fields, each tagged with its signal and field"
    )
    model_confidence: float = Field(
        ge=0, le=1, description="your own confidence; recorded in the audit trail only"
    )


class LocatedEvidence(BaseModel):
    """An evidence quote that code found in its signal (offsets computed in code)."""

    quote: str
    signal: int
    source: str  # signal type: whatsapp | email | pdf
    field: EvidenceField
    start: int
    end: int
    text: str  # the signal text between start and end, as written


class PerceivedDisruption(_DisruptionFields):
    """The stored disruption: model fields + code-located evidence + code-graded confidence."""

    evidence: list[LocatedEvidence] = []
    evidence_quotes: list[str] = []
    confidence: Literal["Low", "Medium", "High"]
    confidence_basis: dict[str, Any] = {}

    def for_llm(self) -> dict[str, Any]:
        """What later stages show the model (no offsets)."""
        return self.model_dump(mode="json", exclude={"evidence", "confidence_basis"})


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
