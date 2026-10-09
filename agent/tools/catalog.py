"""The SIAGA tools. Numbers come from SAP rows and the solver; tools never price by guess.

Tier 0 (read / alert): find_inbound_purchase_orders, assess_impact, search_precedents,
    simulate_option, get_action_status, request_human_approval
Tier 1 (draft):        draft_rfq
Tier 2/3 (action):     execute_stock_transfer (2 if reversible internal < Rp 50M, else 3),
                       create_purchase_order (3), book_spot_air (3),
                       reschedule_customer_order (3)
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from agent.clients import odata_key
from agent.policy import PolicyContext
from agent.tools.base import Tool, ToolContext, ToolRegistry
from agent.tools.sap_to_solver import build_risk_request, build_solve_request
from services.solver.models import Constraint, RiskResult, SolveResult, Strategy

OBSERVE = PolicyContext(observe_only=True)


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _Out(BaseModel):
    model_config = ConfigDict(extra="allow")


# ============================================================== Tier 0: reads


class FindInboundIn(_In):
    lane: str | None = Field(None, description="transport lane ID, e.g. SMG-JKT")
    references: list[str] = Field([], description="PO numbers mentioned in the signals")
    plant: str | None = Field(None, description="destination plant filter, e.g. DC-CKR")


class FindInboundOut(_Out):
    purchase_orders: list[dict[str, Any]]


class FindInboundPurchaseOrders(Tool):
    name = "find_inbound_purchase_orders"
    description = (
        "Find open inbound purchase orders on a transport lane and/or by PO number, with "
        "their items (material, plant, quantity, scheduled delivery time)."
    )
    kind = "read"
    Input = FindInboundIn
    Output = FindInboundOut

    def policy_context(self, args, ctx):
        return OBSERVE

    def run(self, args: FindInboundIn, ctx: ToolContext) -> FindInboundOut:
        clauses = []
        if args.lane:
            clauses.append(f"YY1_TransportLane eq {odata_key(args.lane)}")
        clauses += [f"PurchaseOrder eq {odata_key(r)}" for r in args.references]
        if not clauses:
            raise ValueError("give a lane and/or PO references")
        headers = ctx.sap.query(
            "A_PurchaseOrder", filter=f"({' or '.join(clauses)}) and YY1_Status eq 'OPEN'"
        )
        out = []
        for h in headers:
            items = ctx.sap.query(
                "A_PurchaseOrderItem", filter=f"PurchaseOrder eq {odata_key(h['PurchaseOrder'])}"
            )
            if args.plant:
                items = [i for i in items if i["Plant"] == args.plant]
            if items:
                out.append({**h, "items": items})
        return FindInboundOut(purchase_orders=out)


class AssessImpactIn(_In):
    material: str
    plant: str = Field(description="destination plant whose orders are at risk")
    affected_references: list[str] = Field(description="delayed PO numbers")
    delay_hours_min: float = Field(ge=0)
    delay_hours_max: float = Field(ge=0)


class AssessImpactOut(_Out):
    risk: RiskResult
    stock: dict[str, Any]
    sales_orders: list[dict[str, Any]]


class AssessImpact(Tool):
    name = "assess_impact"
    description = (
        "Compute shortfall, stockout probability per customer order and exposure (max and "
        "expected) for a material at a plant, given delayed POs and a uniform delay range. "
        "Deterministic risk function; reads stock, inbound POs and sales orders from SAP."
    )
    kind = "read"
    Input = AssessImpactIn
    Output = AssessImpactOut

    def policy_context(self, args, ctx):
        return OBSERVE

    def run(self, args: AssessImpactIn, ctx: ToolContext) -> AssessImpactOut:
        stock = ctx.sap.get("A_MaterialStock", odata_key(Material=args.material, Plant=args.plant))
        items = ctx.sap.query(
            "A_PurchaseOrderItem",
            filter=f"Material eq {odata_key(args.material)} and Plant eq {odata_key(args.plant)}",
        )
        sos = ctx.sap.query(
            "A_SalesOrder",
            filter=f"Material eq {odata_key(args.material)} and Plant eq {odata_key(args.plant)}",
        )
        req = build_risk_request(
            material=args.material,
            plant=args.plant,
            stock=stock,
            po_items=items,
            sales_orders=sos,
            affected_refs=args.affected_references,
            delay_hours_min=args.delay_hours_min,
            delay_hours_max=args.delay_hours_max,
        )
        return AssessImpactOut(risk=ctx.solver.risk(req), stock=stock, sales_orders=sos)


class SearchPrecedentsIn(_In):
    query: str
    k: int = Field(3, ge=1, le=5)


class SearchPrecedentsOut(_Out):
    hits: list[dict[str, Any]]


class SearchPrecedents(Tool):
    name = "search_precedents"
    description = "Retrieve similar past disruption cases (what was done, what it cost)."
    kind = "read"
    Input = SearchPrecedentsIn
    Output = SearchPrecedentsOut

    def policy_context(self, args, ctx):
        return OBSERVE

    def run(self, args: SearchPrecedentsIn, ctx: ToolContext) -> SearchPrecedentsOut:
        return SearchPrecedentsOut(hits=[h.model_dump() for h in ctx.kb.search(args.query, args.k)])


class SimulateOptionIn(_In):
    strategies: list[Strategy] = Field(min_length=1)
    constraints: list[Constraint] = []


class SimulateOption(Tool):
    name = "simulate_option"
    description = (
        "Cost a strategy combination with the MIP solver against the case's assessed "
        "shortfall and deadline. Returns quantities, costs, ETAs, feasibility and stock "
        "left at donor DCs. Needs assess_impact to have run for this case."
    )
    kind = "read"
    Input = SimulateOptionIn
    Output = SolveResult

    def policy_context(self, args, ctx):
        return OBSERVE

    def run(self, args: SimulateOptionIn, ctx: ToolContext) -> SolveResult:
        case = ctx.store.get_case(ctx.case_id)
        if not case.risk or not case.affected:
            raise ValueError("no assessed risk on this case; run assess_impact first")
        risk = RiskResult.model_validate(case.risk)
        material, plant = case.affected["material"], case.affected["plant"]
        # Supply already secured by executed actions in this case reduces the requirement
        # (e.g. the replan after a rejected bridge PO). SAP stock already reflects them.
        secured = sum(
            a.get("quantity", 0)
            for a in case.actions
            if a.get("status") == "EXECUTED" and a.get("covers_shortfall")
        )
        remaining = risk.model_copy(update={"shortfall": max(risk.shortfall - secured, 0)})
        req = build_solve_request(
            risk=remaining,
            material=material,
            destination=plant,
            now=ctx.clock(),
            strategies=args.strategies,
            constraints=args.constraints,
            stock=ctx.sap.query("A_MaterialStock", filter=f"Material eq {odata_key(material)}"),
            lanes=ctx.sap.query("A_TransportLane"),
            suppliers=ctx.sap.query("A_Supplier"),
            quotes=ctx.sap.query("A_FreightQuote"),
        )
        return ctx.solver.solve(req)


class ActionStatusIn(_In):
    stock_transfers: list[str] = []
    purchase_orders: list[str] = []
    freight_orders: list[str] = []


class ActionStatusOut(_Out):
    stock_transfers: list[dict[str, Any]]
    purchase_orders: list[dict[str, Any]]
    freight_orders: list[dict[str, Any]]


class GetActionStatus(Tool):
    name = "get_action_status"
    description = "Read the SAP status of stock transfers, purchase orders and freight orders."
    kind = "read"
    Input = ActionStatusIn
    Output = ActionStatusOut

    def policy_context(self, args, ctx):
        return OBSERVE

    def run(self, args: ActionStatusIn, ctx: ToolContext) -> ActionStatusOut:
        pos = []
        for po in args.purchase_orders:
            header = ctx.sap.get("A_PurchaseOrder", odata_key(po))
            items = ctx.sap.query("A_PurchaseOrderItem", filter=f"PurchaseOrder eq {odata_key(po)}")
            pos.append({**header, "items": items})
        return ActionStatusOut(
            stock_transfers=[
                ctx.sap.get("StockTransfer", odata_key(t)) for t in args.stock_transfers
            ],
            purchase_orders=pos,
            freight_orders=[ctx.sap.get("FreightOrder", odata_key(f)) for f in args.freight_orders],
        )


class RequestApprovalIn(_In):
    tool: str = Field(description="the Tier 3 tool to approve")
    args: dict[str, Any] = Field(description="exact arguments the tool will be called with")
    card: dict[str, Any] = Field(
        description="approval card: what, why, cost, alternatives, if_rejected, approve_by"
    )


class RequestApprovalOut(_Out):
    approval_id: str
    status: str


class RequestHumanApproval(Tool):
    name = "request_human_approval"
    description = (
        "Raise a Tier 3 approval request to the human planner for one exact action. "
        "This only alerts; the action runs after the planner approves."
    )
    kind = "read"
    Input = RequestApprovalIn
    Output = RequestApprovalOut
    llm_visible = False  # raised by the ACT stage from solver output, not by the model

    def __init__(self, registry: ToolRegistry):
        self.registry = registry

    def policy_context(self, args, ctx):
        return OBSERVE

    def run(self, args: RequestApprovalIn, ctx: ToolContext) -> RequestApprovalOut:
        target = self.registry.get(args.tool)
        target_args = target.Input.model_validate(args.args)
        if target.tier(target_args, ctx).tier < 3:
            raise ValueError(f"{args.tool} with these arguments does not need approval")
        a = ctx.store.create_approval(
            ctx.case_id, args.tool, target_args.model_dump(mode="json"), args.card
        )
        ctx.audit.append(
            ctx.case_id,
            "approval",
            {"event": "requested", "approval_id": a.approval_id, "tool": a.tool, "args": a.args},
        )
        return RequestApprovalOut(approval_id=a.approval_id, status=a.status)


# ============================================================== Tier 1: drafts


class DraftRfqIn(_In):
    supplier: str
    material: str
    quantity: int = Field(gt=0)
    needed_by: datetime


class DraftRfqOut(_Out):
    draft: dict[str, Any]


class DraftRfq(Tool):
    name = "draft_rfq"
    description = "Prepare an RFQ draft for a supplier for human review. Nothing is sent."
    kind = "draft"
    Input = DraftRfqIn
    Output = DraftRfqOut

    def policy_context(self, args, ctx):
        return PolicyContext(draft_only=True)

    def run(self, args: DraftRfqIn, ctx: ToolContext) -> DraftRfqOut:
        supplier = ctx.sap.get("A_Supplier", odata_key(args.supplier))
        return DraftRfqOut(
            draft={
                "status": "DRAFT",
                "supplier": args.supplier,
                "supplier_name": supplier["SupplierName"],
                "material": args.material,
                "quantity": args.quantity,
                "needed_by": args.needed_by.isoformat(),
                "case_id": ctx.case_id,
            }
        )


# ============================================================== Tier 2/3: actions


class StockTransferIn(_In):
    material: str
    from_plant: str
    to_plant: str
    quantity: int = Field(gt=0)
    trucks: int = Field(gt=0)


class StockTransferOut(_Out):
    StockTransfer: str
    FreightCostIDR: int


class ExecuteStockTransfer(Tool):
    name = "execute_stock_transfer"
    description = (
        "Post an internal stock transfer between own DCs in SAP. Tier 2 (auto-execute) when "
        "reversible and under Rp 50M freight cost; otherwise Tier 3 (needs approval)."
    )
    kind = "action"
    Input = StockTransferIn
    Output = StockTransferOut
    llm_visible = False  # executed by the ACT stage from the chosen solver plan

    def _lane(self, args: StockTransferIn, ctx: ToolContext) -> dict[str, Any] | None:
        lanes = ctx.sap.query(
            "A_TransportLane",
            filter=(
                f"FromLocation eq {odata_key(args.from_plant)} "
                f"and ToLocation eq {odata_key(args.to_plant)}"
            ),
        )
        return lanes[0] if lanes else None

    def policy_context(self, args: StockTransferIn, ctx: ToolContext) -> PolicyContext:
        lane = self._lane(args, ctx)
        plants = {p["Plant"] for p in ctx.sap.query("A_Plant")}
        internal = args.from_plant in plants and args.to_plant in plants
        if lane is None or lane.get("CostPerTruckIDR") is None:
            return PolicyContext(internal=internal, reversible=False)
        return PolicyContext(
            internal=internal,
            reversible=bool(lane["IsReversibleInternal"]),
            amount_idr=args.trucks * lane["CostPerTruckIDR"],
        )

    def run(self, args: StockTransferIn, ctx: ToolContext) -> StockTransferOut:
        approval = self.guard(args, ctx)
        row = ctx.sap.post(
            "/StockTransfer",
            {
                "Material": args.material,
                "FromPlant": args.from_plant,
                "ToPlant": args.to_plant,
                "Quantity": args.quantity,
                "NumberOfTrucks": args.trucks,
                "YY1_CaseId": ctx.case_id,
                "IdempotencyKey": approval.approval_id
                if approval
                else f"{ctx.case_id}:transfer:{args.from_plant}:{args.to_plant}:{args.quantity}",
            },
        )
        return StockTransferOut(**row)


class PurchaseOrderIn(_In):
    supplier: str
    material: str
    plant: str
    quantity: int = Field(gt=0)


class PurchaseOrderOut(_Out):
    PurchaseOrder: str
    YY1_Status: str


class CreatePurchaseOrder(Tool):
    name = "create_purchase_order"
    description = "Create a purchase order in SAP. Always Tier 3: new external commitment."
    kind = "action"
    Input = PurchaseOrderIn
    Output = PurchaseOrderOut
    llm_visible = False

    def policy_context(self, args: PurchaseOrderIn, ctx: ToolContext) -> PolicyContext:
        supplier = ctx.sap.get("A_Supplier", odata_key(args.supplier))
        premium = supplier.get("YY1_PremiumPerCartonIDR") or 0
        return PolicyContext(external_commitment=True, amount_idr=premium * args.quantity)

    def run(self, args: PurchaseOrderIn, ctx: ToolContext) -> PurchaseOrderOut:
        approval = self.guard(args, ctx)
        assert approval is not None  # guard() raises for Tier 3 without approval
        row = ctx.sap.post(
            "/A_PurchaseOrder",
            {
                "Supplier": args.supplier,
                "to_PurchaseOrderItem": [
                    {"Material": args.material, "Plant": args.plant, "OrderQuantity": args.quantity}
                ],
                "YY1_CaseId": ctx.case_id,
                "YY1_ApprovalId": approval.approval_id,
                "IdempotencyKey": approval.approval_id,
            },
        )
        return PurchaseOrderOut(**row)


class SpotAirIn(_In):
    quote: str
    quantity: int = Field(gt=0)


class SpotAirOut(_Out):
    FreightOrder: str
    Status: str


class BookSpotAir(Tool):
    name = "book_spot_air"
    description = "Book a quoted air charter. Always Tier 3: spot air freight."
    kind = "action"
    Input = SpotAirIn
    Output = SpotAirOut
    llm_visible = False

    def policy_context(self, args: SpotAirIn, ctx: ToolContext) -> PolicyContext:
        quote = ctx.sap.get("A_FreightQuote", odata_key(args.quote))
        return PolicyContext(spot_air=True, external_commitment=True, amount_idr=quote["PriceIDR"])

    def run(self, args: SpotAirIn, ctx: ToolContext) -> SpotAirOut:
        approval = self.guard(args, ctx)
        assert approval is not None
        row = ctx.sap.post(
            "/FreightOrder",
            {
                "FreightQuote": args.quote,
                "Quantity": args.quantity,
                "YY1_CaseId": ctx.case_id,
                "YY1_ApprovalId": approval.approval_id,
                "IdempotencyKey": approval.approval_id,
            },
        )
        return SpotAirOut(**row)


class RescheduleIn(_In):
    sales_order: str
    new_cutoff: datetime | None = None


class RescheduleOut(_Out):
    SalesOrder: str
    YY1_Status: str


class RescheduleCustomerOrder(Tool):
    name = "reschedule_customer_order"
    description = "Move a customer order's loading date. Always Tier 3: customer SLA change."
    kind = "action"
    Input = RescheduleIn
    Output = RescheduleOut
    llm_visible = False

    def policy_context(self, args: RescheduleIn, ctx: ToolContext) -> PolicyContext:
        so = ctx.sap.get("A_SalesOrder", odata_key(args.sales_order))
        return PolicyContext(
            sla_change=True, external_commitment=True, amount_idr=so["YY1_PenaltyAmountIDR"]
        )

    def run(self, args: RescheduleIn, ctx: ToolContext) -> RescheduleOut:
        approval = self.guard(args, ctx)
        assert approval is not None
        body = {
            "SalesOrder": args.sales_order,
            "YY1_CaseId": ctx.case_id,
            "YY1_ApprovalId": approval.approval_id,
        }
        if args.new_cutoff:
            body["NewLoadingCutoffDateTime"] = args.new_cutoff.isoformat()
        return RescheduleOut(**ctx.sap.post("/SalesOrderReschedule", body))


def build_registry() -> ToolRegistry:
    registry = ToolRegistry([])
    tools: list[Tool] = [
        FindInboundPurchaseOrders(),
        AssessImpact(),
        SearchPrecedents(),
        SimulateOption(),
        GetActionStatus(),
        RequestHumanApproval(registry),
        DraftRfq(),
        ExecuteStockTransfer(),
        CreatePurchaseOrder(),
        BookSpotAir(),
        RescheduleCustomerOrder(),
    ]
    registry.tools = {t.name: t for t in tools}
    return registry
