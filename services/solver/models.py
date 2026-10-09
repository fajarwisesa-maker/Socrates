"""Input/output models of the solver service.

Shared by the FastAPI wrapper (local) and the Lambda handler (Phase 7), and the source
of the solver tool schemas in the agent's tool layer. The solver is a pure function of
these inputs: it never calls SAP itself.

Money is integer IDR; quantities are integer cartons; times are aware datetimes
(serialised as ISO-8601).
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from siaga_common.timeline import to_iso


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @field_serializer("*", when_used="json", check_fields=False)
    def _ser(self, v):  # UTC "Z" timestamps everywhere, like the mock SAP
        return to_iso(v) if isinstance(v, datetime) else v


# ---------------------------------------------------------------- risk


class NoDelay(_Model):
    kind: Literal["none"] = "none"


class FixedDelay(_Model):
    kind: Literal["fixed"] = "fixed"
    hours: float = Field(ge=0)


class UniformDelay(_Model):
    kind: Literal["uniform"] = "uniform"
    min_hours: float = Field(ge=0)
    max_hours: float = Field(ge=0)


DelayDistribution = Annotated[NoDelay | FixedDelay | UniformDelay, Field(discriminator="kind")]


class InboundSupply(_Model):
    ref: str = Field(description="PO / shipment reference")
    quantity: int = Field(ge=0)
    eta: datetime = Field(description="originally scheduled arrival")
    delay: DelayDistribution = Field(default_factory=NoDelay)


class DemandOrder(_Model):
    order: str
    quantity: int = Field(gt=0)
    cutoff: datetime = Field(description="latest loading time")
    penalty: int = Field(ge=0, description="IDR lost if the order is missed")
    penalty_type: str | None = None


class RiskRequest(_Model):
    material: str
    plant: str
    on_hand: int = Field(ge=0)
    safety_stock: int = Field(ge=0)
    inbound: list[InboundSupply] = []
    orders: list[DemandOrder] = Field(min_length=1)


class InboundRisk(_Model):
    ref: str
    quantity: int
    arrival_earliest: datetime
    arrival_latest: datetime


class OrderRisk(_Model):
    order: str
    quantity: int
    cutoff: datetime
    penalty: int
    stockout_probability: float = Field(ge=0, le=1)
    expected_exposure: int


class RiskResult(_Model):
    usable_stock: int = Field(description="on hand minus safety stock")
    demand: int
    shortfall: int = Field(description="demand not coverable if at-risk inbound misses")
    deadline: datetime | None = Field(description="earliest cutoff with a shortfall")
    orders: list[OrderRisk]
    inbound: list[InboundRisk]
    max_exposure: int = Field(description="Σ penalty of orders with P(stockout) > 0")
    expected_exposure: int = Field(description="Σ P(stockout) × penalty")


# ---------------------------------------------------------------- MIP

Strategy = Literal["stock_transfer", "alternate_supplier", "spot_air", "reschedule_customer"]


class TransferSource(_Model):
    plant: str
    on_hand: int = Field(ge=0)
    safety_stock: int = Field(ge=0)
    lane: str
    cost_per_truck: int = Field(ge=0)
    capacity_per_truck: int = Field(gt=0)
    transit_hours: float = Field(ge=0)


class AlternateSupplier(_Model):
    supplier: str
    capacity: int = Field(ge=0)
    lead_time_days: float = Field(ge=0)
    premium_per_unit: int = Field(ge=0)
    incoterm: str | None = None


class AirQuote(_Model):
    quote: str
    price: int = Field(ge=0, description="flat price, any quantity up to the shortfall")
    delivery_at: datetime


class ReschedulableOrder(_Model):
    order: str
    quantity: int = Field(gt=0)
    penalty: int = Field(ge=0)


class SafetyStockConstraint(_Model):
    type: Literal["safety_stock"] = "safety_stock"


class ExcludeSupplierConstraint(_Model):
    type: Literal["exclude_supplier"] = "exclude_supplier"
    supplier: str


Constraint = Annotated[
    SafetyStockConstraint | ExcludeSupplierConstraint, Field(discriminator="type")
]


class SolveRequest(_Model):
    material: str
    destination: str
    required_quantity: int = Field(ge=0, description="shortfall to cover")
    now: datetime = Field(description="plan time; approvals assumed immediate")
    deadline: datetime = Field(description="supply must arrive by this time")
    strategies: list[Strategy] = Field(min_length=1)
    transfer_sources: list[TransferSource] = []
    suppliers: list[AlternateSupplier] = []
    air_quotes: list[AirQuote] = []
    orders: list[ReschedulableOrder] = []
    constraints: list[Constraint] = []


class PlannedAction(_Model):
    kind: Strategy
    reference: str = Field(description="source plant / supplier / quote / order")
    quantity: int
    trucks: int | None = None
    cost: int
    cost_basis: str
    eta: datetime | None
    lead_hours: float | None = Field(
        None, description="hours from start (dispatch / approval) to arrival; None = fixed time"
    )
    dispatch_by: datetime | None = Field(
        None, description="latest start (dispatch / approval) that still meets the deadline"
    )


class StockAfter(_Model):
    plant: str
    on_hand_after: int
    safety_stock: int


class SolveResult(_Model):
    status: Literal["optimal", "infeasible"]
    strategies: list[Strategy]
    constraints: list[Constraint]
    required_quantity: int
    covered_quantity: int
    total_cost: int
    actions: list[PlannedAction]
    stock_after: list[StockAfter]
    excluded: list[str] = Field(
        default=[], description="options ruled out before solving, with the reason"
    )
    infeasible_reason: str | None = None
    engine: str = "PuLP/CBC"
    solve_ms: float = 0.0


# ---------------------------------------------------------------- comparison / timing


class CompareRequest(_Model):
    baseline: SolveResult
    chosen: SolveResult
    max_exposure: int


class CompareResult(_Model):
    saving_vs_baseline: int
    exposure_avoided: int


class TimingCheckRequest(_Model):
    action: PlannedAction
    deadline: datetime
    at: datetime = Field(description="actual approval / execution time")


class TimingCheckResult(_Model):
    feasible: bool
    eta_if_started_at: datetime | None
    latest_start: datetime | None
    reason: str
