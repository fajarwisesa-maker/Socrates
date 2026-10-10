"""Mitigation MIP (PuLP / CBC).

    minimise   Σ_s truck_cost_s · trucks_s  +  Σ_v premium_v · q_v
             + Σ_a air_price_a · y_a        +  Σ_o penalty_o · r_o
    subject to Σ_s t_s + Σ_v q_v + Σ_a x_a + Σ_o qty_o · r_o  ≥  required      (cover)
               t_s ≤ capacity_per_truck_s · trucks_s                            (integer trucks)
               t_s ≤ on_hand_s  [− safety_stock_s with the safety_stock constraint]
               q_v ≤ capacity_v
               x_a ≤ required · y_a                       (flat price covers the shortfall)
               options whose arrival is after the deadline are excluded up front
               trucks_s, t_s, q_v ∈ ℤ≥0;  y_a, r_o ∈ {0,1}

A tiny ε per moved carton breaks ties towards moving less stock; all real costs are
integer IDR, so ε never changes which solution is cheapest. Reported costs are computed
from the solution, not from the objective.
"""

from __future__ import annotations

import time
from datetime import timedelta

import pulp

from services.solver.models import (
    CompareRequest,
    CompareResult,
    ExcludeSupplierConstraint,
    PlannedAction,
    SafetyStockConstraint,
    SolveRequest,
    SolveResult,
    StockAfter,
    TimingCheckRequest,
    TimingCheckResult,
)

EPSILON = 1e-4
TIME_LIMIT_S = 10
# Note: do not pass threads=1 together with timeLimit to CBC 2.10 (PuLP 2.9 bundle): that
# combination intermittently stalls until the time limit (seen ~1 in 20 solves).


def _int(v: float | None) -> int:
    return round(v or 0)


def solve(req: SolveRequest) -> SolveResult:
    t0 = time.perf_counter()
    use_safety = any(isinstance(c, SafetyStockConstraint) for c in req.constraints)
    excluded_suppliers = {
        c.supplier for c in req.constraints if isinstance(c, ExcludeSupplierConstraint)
    }
    strategies = set(req.strategies)
    excluded: list[str] = []

    prob = pulp.LpProblem("siaga_mitigation", pulp.LpMinimize)
    cost_terms, move_terms, cover_terms = [], [], []

    # --- stock transfers ---
    transfers = []
    if "stock_transfer" in strategies:
        for i, s in enumerate(req.transfer_sources):
            eta = req.now + timedelta(hours=s.transit_hours)
            if eta > req.deadline:
                excluded.append(f"transfer from {s.plant}: arrives after the deadline")
                continue
            avail = max(s.on_hand - (s.safety_stock if use_safety else 0), 0)
            trucks = pulp.LpVariable(f"trucks_{i}", lowBound=0, cat="Integer")
            qty = pulp.LpVariable(f"transfer_{i}", lowBound=0, upBound=avail, cat="Integer")
            prob += qty <= s.capacity_per_truck * trucks, f"truck_capacity_{i}"
            cost_terms.append(s.cost_per_truck * trucks)
            move_terms.append(qty)
            cover_terms.append(qty)
            transfers.append((s, trucks, qty, eta))

    # --- alternate suppliers (bridge orders) ---
    bridges = []
    if "alternate_supplier" in strategies:
        for i, v in enumerate(req.suppliers):
            if v.supplier in excluded_suppliers:
                excluded.append(f"supplier {v.supplier}: excluded by constraint")
                continue
            eta = req.now + timedelta(days=v.lead_time_days)
            if eta > req.deadline:
                excluded.append(f"supplier {v.supplier}: lead time misses the deadline")
                continue
            qty = pulp.LpVariable(f"bridge_{i}", lowBound=0, upBound=v.capacity, cat="Integer")
            cost_terms.append(v.premium_per_unit * qty)
            cover_terms.append(qty)
            bridges.append((v, qty, eta))

    # --- spot air (flat price) ---
    airs = []
    if "spot_air" in strategies:
        for i, a in enumerate(req.air_quotes):
            if a.delivery_at > req.deadline:
                excluded.append(f"air quote {a.quote}: delivers after the deadline")
                continue
            use = pulp.LpVariable(f"air_{i}", cat="Binary")
            qty = pulp.LpVariable(f"air_qty_{i}", lowBound=0, cat="Integer")
            prob += qty <= req.required_quantity * use, f"air_flat_cover_{i}"
            cost_terms.append(a.price * use)
            move_terms.append(qty)
            cover_terms.append(qty)
            airs.append((a, use, qty))

    # --- reschedule whole customer orders ---
    resched = []
    if "reschedule_customer" in strategies:
        for i, o in enumerate(req.orders):
            r = pulp.LpVariable(f"reschedule_{i}", cat="Binary")
            cost_terms.append(o.penalty * r)
            cover_terms.append(o.quantity * r)
            resched.append((o, r))

    prob += pulp.lpSum(cost_terms) + EPSILON * pulp.lpSum(move_terms)
    prob += pulp.lpSum(cover_terms) >= req.required_quantity, "cover_shortfall"

    status = prob.solve(pulp.PULP_CBC_CMD(msg=False, timeLimit=TIME_LIMIT_S))
    solve_ms = round((time.perf_counter() - t0) * 1000, 1)

    base = dict(
        strategies=req.strategies,
        constraints=req.constraints,
        required_quantity=req.required_quantity,
        excluded=excluded,
        solve_ms=solve_ms,
    )
    # sol_status distinguishes a proven optimum from a time-limited incumbent.
    if pulp.LpStatus[status] != "Optimal" or prob.sol_status != pulp.LpSolutionOptimal:
        return SolveResult(
            status="infeasible",
            covered_quantity=0,
            total_cost=0,
            actions=[],
            stock_after=[],
            infeasible_reason=(
                _infeasible_reason(req, transfers, bridges, airs, resched)
                if pulp.LpStatus[status] == "Infeasible"
                else f"solver stopped without a proven optimum ({pulp.LpStatus[status]})"
            ),
            **base,
        )

    actions: list[PlannedAction] = []
    stock_after: list[StockAfter] = []
    for s, trucks, qty, eta in transfers:
        q, n = _int(qty.value()), _int(trucks.value())
        stock_after.append(
            StockAfter(plant=s.plant, on_hand_after=s.on_hand - q, safety_stock=s.safety_stock)
        )
        if q > 0:
            actions.append(
                PlannedAction(
                    kind="stock_transfer",
                    reference=s.plant,
                    quantity=q,
                    trucks=n,
                    cost=n * s.cost_per_truck,
                    cost_basis=f"{n} truck(s) x {s.cost_per_truck} IDR",
                    eta=eta,
                    lead_hours=s.transit_hours,
                    dispatch_by=req.deadline - timedelta(hours=s.transit_hours),
                )
            )
    for v, qty, eta in bridges:
        q = _int(qty.value())
        if q > 0:
            actions.append(
                PlannedAction(
                    kind="alternate_supplier",
                    reference=v.supplier,
                    quantity=q,
                    cost=q * v.premium_per_unit,
                    cost_basis=f"{q} cartons x {v.premium_per_unit} IDR premium",
                    eta=eta,
                    lead_hours=v.lead_time_days * 24,
                    dispatch_by=req.deadline - timedelta(days=v.lead_time_days),
                )
            )
    for a, use, qty in airs:
        if _int(use.value()) == 1:
            actions.append(
                PlannedAction(
                    kind="spot_air",
                    reference=a.quote,
                    quantity=_int(qty.value()),
                    cost=a.price,
                    cost_basis=f"flat charter {a.price} IDR",
                    eta=a.delivery_at,
                    lead_hours=None,
                    dispatch_by=None,
                )
            )
    for o, r in resched:
        if _int(r.value()) == 1:
            actions.append(
                PlannedAction(
                    kind="reschedule_customer",
                    reference=o.order,
                    quantity=o.quantity,
                    cost=o.penalty,
                    cost_basis=f"full penalty / lost margin of {o.order}",
                    eta=None,
                )
            )
    return SolveResult(
        status="optimal",
        covered_quantity=sum(a.quantity for a in actions),
        total_cost=sum(a.cost for a in actions),
        actions=actions,
        stock_after=stock_after,
        **base,
    )


def _infeasible_reason(req, transfers, bridges, airs, resched) -> str:
    use_safety = any(isinstance(c, SafetyStockConstraint) for c in req.constraints)
    parts, total = [], 0
    for s, *_ in transfers:
        avail = max(s.on_hand - (s.safety_stock if use_safety else 0), 0)
        parts.append(f"transfer {s.plant} ≤ {avail}")
        total += avail
    for v, *_ in bridges:
        parts.append(f"{v.supplier} ≤ {v.capacity}")
        total += v.capacity
    for a, *_ in airs:
        parts.append(f"air {a.quote} ≤ {req.required_quantity}")
        total += req.required_quantity
    for o, _ in resched:
        parts.append(f"reschedule {o.order} = {o.quantity}")
        total += o.quantity
    detail = ", ".join(parts) or "no usable option"
    return (
        f"cannot cover {req.required_quantity} cartons by the deadline: "
        f"at most {total} available ({detail})"
    )


def check_timing(req: TimingCheckRequest) -> TimingCheckResult:
    """Re-check an action against the actual approval / execution time."""
    a = req.action
    if a.lead_hours is None:  # fixed delivery time (e.g. air charter)
        ok = a.eta is not None and a.eta <= req.deadline
        return TimingCheckResult(
            feasible=ok,
            eta_if_started_at=a.eta,
            latest_start=None,
            reason="fixed delivery time " + ("meets" if ok else "misses") + " the deadline",
        )
    eta = req.at + timedelta(hours=a.lead_hours)
    latest = req.deadline - timedelta(hours=a.lead_hours)
    ok = eta <= req.deadline
    return TimingCheckResult(
        feasible=ok,
        eta_if_started_at=eta,
        latest_start=latest,
        reason=(
            "arrives before the deadline"
            if ok
            else f"started after the latest start; arrives {eta - req.deadline} late"
        ),
    )


def compare(req: CompareRequest) -> CompareResult:
    """Saving of the chosen plan vs a baseline, the exposure it avoids, what the case costs
    (chosen plan + actions already executed) and the net amount protected."""
    chosen = req.chosen
    if chosen.status != "optimal" or chosen.covered_quantity < chosen.required_quantity:
        return CompareResult(
            saving_vs_baseline=0 if req.baseline else None,
            exposure_avoided=0,
            case_cost=req.already_spent,
            net_protected=0,
        )
    accepted_losses = sum(a.cost for a in chosen.actions if a.kind == "reschedule_customer")
    avoided = req.max_exposure - accepted_losses
    return CompareResult(
        saving_vs_baseline=(
            req.baseline.total_cost - chosen.total_cost if req.baseline is not None else None
        ),
        exposure_avoided=avoided,
        case_cost=chosen.total_cost + req.already_spent,
        net_protected=avoided - chosen.total_cost - req.already_spent,
    )
