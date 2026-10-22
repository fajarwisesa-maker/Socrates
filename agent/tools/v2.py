"""v2 tools for the specialist agents (ORCHESTRATION=multi). Registered only in that mode.

Most are the v1 tools under the names of the v2 brief (same arguments, same outputs, same
tier mapping); a few are finer-grained reads so the Impact Agent can choose its lookups:

    Signal Agent    extract_pdf_text
    Impact Agent    find_open_pos, get_stock, get_sales_orders, compute_risk
    Planner Agent   search_precedents, run_solver
    Critic Agent    check_business_rules
    Executor Agent  create_stock_transfer, request_approval, create_purchase_order,
                    book_spot_air, reschedule_customer_order, check_status

Every one goes through the same registry path as v1: budget, arguments, tier in code,
Cedar, the tool's own in-code guard, audit.
"""

from __future__ import annotations

from typing import Any

from pydantic import Field

from agent import critic
from agent.clients import odata_key
from agent.tools.base import Tool, ToolContext, ToolRegistry
from agent.tools.catalog import (
    OBSERVE,
    AssessImpact,
    ExecuteStockTransfer,
    FindInboundPurchaseOrders,
    GetActionStatus,
    RequestHumanApproval,
    SimulateOption,
    SimulateOptionIn,
    _In,
    _Out,
)
from services.solver.models import RiskResult, SolveResult, Strategy

# ============================================================== Signal Agent


class ExtractPdfIn(_In):
    signal: int = Field(ge=1, description="number of the PDF signal to read")


class ExtractPdfOut(_Out):
    signal: int
    filename: str | None
    text: str


class ExtractPdfText(Tool):
    name = "extract_pdf_text"
    description = (
        "Read the text of a PDF attachment of this case (its text layer, extracted with "
        "pypdf when the case was opened)."
    )
    kind = "read"
    Input = ExtractPdfIn
    Output = ExtractPdfOut

    def policy_context(self, args, ctx):
        return OBSERVE

    def run(self, args: ExtractPdfIn, ctx: ToolContext) -> ExtractPdfOut:
        signals = ctx.store.get_case(ctx.case_id).signals
        if args.signal > len(signals) or signals[args.signal - 1]["type"] != "pdf":
            raise ValueError(f"signal {args.signal} is not a PDF attachment of this case")
        s = signals[args.signal - 1]
        return ExtractPdfOut(signal=args.signal, filename=s.get("filename"), text=s["text"])


# ============================================================== Impact Agent


class FindOpenPOs(FindInboundPurchaseOrders):
    name = "find_open_pos"


class GetStockIn(_In):
    material: str
    plants: list[str] = Field([], description="plant IDs; empty = every plant")


class GetStockOut(_Out):
    stock: list[dict[str, Any]]


class GetStock(Tool):
    name = "get_stock"
    description = (
        "Read on-hand, in-transit and safety stock of a material at one or more plants (DCs)."
    )
    kind = "read"
    Input = GetStockIn
    Output = GetStockOut

    def policy_context(self, args, ctx):
        return OBSERVE

    def run(self, args: GetStockIn, ctx: ToolContext) -> GetStockOut:
        rows = ctx.sap.query("A_MaterialStock", filter=f"Material eq {odata_key(args.material)}")
        if args.plants:
            rows = [r for r in rows if r["Plant"] in args.plants]
        return GetStockOut(stock=rows)


class GetSalesOrdersIn(_In):
    material: str
    plant: str = Field(description="shipping plant (DC)")


class GetSalesOrdersOut(_Out):
    sales_orders: list[dict[str, Any]]


class GetSalesOrders(Tool):
    name = "get_sales_orders"
    description = (
        "Read open customer sales orders for a material shipped from a plant, with their "
        "loading cutoff and penalty or lost margin."
    )
    kind = "read"
    Input = GetSalesOrdersIn
    Output = GetSalesOrdersOut

    def policy_context(self, args, ctx):
        return OBSERVE

    def run(self, args: GetSalesOrdersIn, ctx: ToolContext) -> GetSalesOrdersOut:
        rows = ctx.sap.query(
            "A_SalesOrder",
            filter=f"Material eq {odata_key(args.material)} and Plant eq {odata_key(args.plant)}",
        )
        return GetSalesOrdersOut(sales_orders=rows)


class ComputeRisk(AssessImpact):
    name = "compute_risk"


# ============================================================== Planner Agent


class RunSolverIn(_In):
    strategies: list[Strategy] = Field(min_length=1)


class RunSolver(Tool):
    name = "run_solver"
    description = (
        "Cost one strategy combination with the MIP solver against the case's assessed "
        "shortfall and deadline. The case's active constraints (e.g. safety stock, an "
        "excluded supplier) are applied automatically. Returns quantities, costs, ETAs, "
        "feasibility and stock left at donor DCs."
    )
    kind = "read"
    Input = RunSolverIn
    Output = SolveResult

    def policy_context(self, args, ctx):
        return OBSERVE

    def run(self, args: RunSolverIn, ctx: ToolContext) -> SolveResult:
        # Constraints come from the case (added by the Critic or a rejection), never from
        # the model, so a replan cannot drop them.
        constraints = ctx.store.get_case(ctx.case_id).constraints
        return SimulateOption().run(
            SimulateOptionIn(strategies=args.strategies, constraints=constraints), ctx
        )


# ============================================================== Critic Agent


class CheckRulesIn(_In):
    round: int = Field(ge=1, description="planning round whose options to check")


class CheckRulesOut(_Out):
    round: int
    reviews: list[dict[str, Any]]


class CheckBusinessRules(Tool):
    name = "check_business_rules"
    description = (
        "Check every simulated option of a planning round against the business rules "
        "(feasible, safety stock, Incoterms, supplier capacity, cutoff met, authority tier). "
        "Deterministic; returns each rule's result with a plain-language sentence."
    )
    kind = "read"
    Input = CheckRulesIn
    Output = CheckRulesOut

    def __init__(self, registry: ToolRegistry):
        self.registry = registry

    def policy_context(self, args, ctx):
        return OBSERVE

    def run(self, args: CheckRulesIn, ctx: ToolContext) -> CheckRulesOut:
        return CheckRulesOut(round=args.round, reviews=review_round(args.round, ctx, self.registry))


def review_round(rnd: int, ctx: ToolContext, registry: ToolRegistry) -> list[dict[str, Any]]:
    """critic.review for every option of a round (also used by the orchestrator)."""
    case = ctx.store.get_case(ctx.case_id)
    options = [o for o in case.solver_results if o["round"] == rnd]
    if not options:
        raise ValueError(f"no simulated options in round {rnd}")
    risk = RiskResult.model_validate(case.risk)
    suppliers = {s["Supplier"]: s for s in ctx.sap.query("A_Supplier")}
    return [
        critic.review(
            o["option_id"],
            SolveResult.model_validate(o["result"]),
            risk,
            material=case.affected["material"],
            plant=case.affected["plant"],
            suppliers=suppliers,
            registry=registry,
            ctx=ctx,
            plant_names=(case.affected.get("labels") or {}).get("plants"),
        ).model_dump()
        for o in options
    ]


# ============================================================== Executor Agent


class CreateStockTransfer(ExecuteStockTransfer):
    name = "create_stock_transfer"


class RequestApproval(RequestHumanApproval):
    name = "request_approval"


class CheckStatus(GetActionStatus):
    name = "check_status"


def v2_tools(registry: ToolRegistry) -> list[Tool]:
    return [
        ExtractPdfText(),
        FindOpenPOs(),
        GetStock(),
        GetSalesOrders(),
        ComputeRisk(),
        RunSolver(),
        CheckBusinessRules(registry),
        CreateStockTransfer(),
        RequestApproval(registry),
        CheckStatus(),
    ]
