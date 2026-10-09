"""Map mock-S/4HANA OData rows to solver inputs (pure functions, no I/O).

Every number the solver uses comes from SAP rows or from the structured disruption;
nothing is priced here.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime
from typing import Any

from services.solver.models import (
    AirQuote,
    AlternateSupplier,
    Constraint,
    DemandOrder,
    InboundSupply,
    NoDelay,
    ReschedulableOrder,
    RiskRequest,
    RiskResult,
    SolveRequest,
    Strategy,
    TransferSource,
    UniformDelay,
)
from siaga_common.timeline import from_iso

Row = dict[str, Any]


def build_risk_request(
    *,
    material: str,
    plant: str,
    stock: Row,
    po_items: Iterable[Row],
    sales_orders: Iterable[Row],
    affected_refs: Iterable[str],
    delay_hours_min: float,
    delay_hours_max: float,
) -> RiskRequest:
    """Delay is modelled as uniform [min, max] hours on affected POs' original ETA."""
    affected = set(affected_refs)
    inbound = [
        InboundSupply(
            ref=it["PurchaseOrder"],
            quantity=it["YY1_ConfirmedQuantity"],
            eta=from_iso(it["YY1_ScheduledDeliveryDateTime"]),
            delay=(
                UniformDelay(min_hours=delay_hours_min, max_hours=delay_hours_max)
                if it["PurchaseOrder"] in affected
                else NoDelay()
            ),
        )
        for it in po_items
        if it["Material"] == material
        and it["Plant"] == plant
        and it.get("YY1_ScheduledDeliveryDateTime")
    ]
    orders = [
        DemandOrder(
            order=so["SalesOrder"],
            quantity=so["RequestedQuantity"],
            cutoff=from_iso(so["YY1_LoadingCutoffDateTime"]),
            penalty=so["YY1_PenaltyAmountIDR"],
            penalty_type=so.get("YY1_PenaltyType"),
        )
        for so in sales_orders
        if so["Material"] == material and so["Plant"] == plant and so["YY1_Status"] == "OPEN"
    ]
    return RiskRequest(
        material=material,
        plant=plant,
        on_hand=stock["OnHandQuantity"],
        safety_stock=stock["SafetyStockQuantity"],
        inbound=inbound,
        orders=orders,
    )


def build_solve_request(
    *,
    risk: RiskResult,
    material: str,
    destination: str,
    now: datetime,
    strategies: list[Strategy],
    constraints: list[Constraint] | None = None,
    stock: Iterable[Row],
    lanes: Iterable[Row],
    suppliers: Iterable[Row],
    quotes: Iterable[Row],
) -> SolveRequest:
    if risk.deadline is None:
        raise ValueError("no shortfall: nothing to solve")
    lanes_in = {
        ln["FromLocation"]: ln
        for ln in lanes
        if ln["ToLocation"] == destination
        and ln.get("IsReversibleInternal")
        and ln.get("CostPerTruckIDR") is not None
    }
    transfer_sources = [
        TransferSource(
            plant=s["Plant"],
            on_hand=s["OnHandQuantity"],
            safety_stock=s["SafetyStockQuantity"],
            lane=lanes_in[s["Plant"]]["TransportLane"],
            cost_per_truck=lanes_in[s["Plant"]]["CostPerTruckIDR"],
            capacity_per_truck=lanes_in[s["Plant"]]["CapacityPerTruckCartons"],
            transit_hours=lanes_in[s["Plant"]]["TransitHours"],
        )
        for s in stock
        if s["Material"] == material and s["Plant"] != destination and s["Plant"] in lanes_in
    ]
    alternates = [
        AlternateSupplier(
            supplier=v["Supplier"],
            capacity=v["YY1_CapacityCartons"],
            lead_time_days=v["YY1_LeadTimeDays"],
            premium_per_unit=v["YY1_PremiumPerCartonIDR"],
            incoterm=v.get("YY1_DefaultIncoterm"),
        )
        for v in suppliers
        if v["YY1_SupplierRole"] == "ALTERNATE"
        and material in (v.get("YY1_ApprovedMaterials") or [])
        and None
        not in (v["YY1_CapacityCartons"], v["YY1_LeadTimeDays"], v["YY1_PremiumPerCartonIDR"])
    ]
    air_quotes = [
        AirQuote(
            quote=q["FreightQuote"],
            price=q["PriceIDR"],
            delivery_at=from_iso(q["YY1_DeliveryDateTime"]),
        )
        for q in quotes
        if q["Mode"] == "AIR_CHARTER"
        and q["Material"] == material
        and q["DestinationPlant"] == destination
        and q["YY1_Status"] == "QUOTED"
    ]
    at_risk = [
        ReschedulableOrder(order=o.order, quantity=o.quantity, penalty=o.penalty)
        for o in risk.orders
        if o.stockout_probability > 0
    ]
    return SolveRequest(
        material=material,
        destination=destination,
        required_quantity=risk.shortfall,
        now=now,
        deadline=risk.deadline,
        strategies=strategies,
        transfer_sources=transfer_sources,
        suppliers=alternates,
        air_quotes=air_quotes,
        orders=at_risk,
        constraints=constraints or [],
    )
