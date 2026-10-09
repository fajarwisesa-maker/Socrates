"""Solver and risk: every golden number of brief §2.2, plus general behaviour.

Inputs are built from the mock SAP (via its OData API), exactly as the agent will.
"""

from datetime import timedelta

import pytest

from agent.tools.sap_to_solver import build_solve_request
from services.solver.mip import check_timing, compare, solve
from services.solver.models import (
    AirQuote,
    CompareRequest,
    DemandOrder,
    ExcludeSupplierConstraint,
    FixedDelay,
    InboundSupply,
    RiskRequest,
    SafetyStockConstraint,
    SolveRequest,
    TimingCheckRequest,
    UniformDelay,
)
from services.solver.risk import assess, p_late
from siaga_common.timeline import at, day_offset
from tests.conftest import DAY0, NOW

B = ["stock_transfer", "alternate_supplier"]


def action(result, kind):
    return next(a for a in result.actions if a.kind == kind)


# ------------------------------------------------------------ §2.2 golden numbers


def test_shortfall_and_exposure(risk):
    assert risk.usable_stock == 100
    assert risk.demand == 1000
    assert risk.shortfall == 900
    assert risk.max_exposure == 340_000_000
    assert risk.expected_exposure == 340_000_000
    assert day_offset(DAY0, risk.deadline) == (2, "18:00")


def test_stockout_probability_is_100_percent_for_both_orders(risk):
    assert {o.order: o.stockout_probability for o in risk.orders} == {
        "SO-7001": 1.0,
        "SO-7002": 1.0,
    }
    (po,) = risk.inbound
    assert day_offset(DAY0, po.arrival_earliest) == (3, "10:00")
    assert day_offset(DAY0, po.arrival_latest) == (4, "10:00")


def test_option_a_air_freight(plan):
    a = plan(["spot_air"])
    assert a.status == "optimal"
    assert a.total_cost == 31_000_000
    air = action(a, "spot_air")
    assert (air.reference, air.quantity) == ("Q-AIR-0001", 900)
    assert day_offset(DAY0, air.eta) == (2, "12:00")


def test_option_b_first_solve_physical_constraints_only(plan):
    b1 = plan(B)
    t, s = action(b1, "stock_transfer"), action(b1, "alternate_supplier")
    assert (t.reference, t.quantity, t.trucks, t.cost) == ("DC-BDG", 750, 3, 5_850_000)
    assert (s.reference, s.quantity, s.cost) == ("V-2002", 150, 2_250_000)
    assert b1.total_cost == 8_100_000
    bdg = next(x for x in b1.stock_after if x.plant == "DC-BDG")
    assert bdg.on_hand_after == 50 < bdg.safety_stock == 400  # what REFLECT will reject


def test_option_b_replan_with_safety_stock(plan):
    b2 = plan(B, [SafetyStockConstraint()])
    t, s = action(b2, "stock_transfer"), action(b2, "alternate_supplier")
    assert (t.quantity, t.trucks, t.cost) == (400, 2, 3_900_000)
    assert (s.quantity, s.cost) == (500, 7_500_000)
    assert b2.total_cost == 11_400_000
    assert b2.covered_quantity == 900
    bdg = next(x for x in b2.stock_after if x.plant == "DC-BDG")
    assert bdg.on_hand_after == bdg.safety_stock == 400


def test_saving_and_exposure_avoided(plan, risk):
    result = compare(
        CompareRequest(
            baseline=plan(["spot_air"]),
            chosen=plan(B, [SafetyStockConstraint()]),
            max_exposure=risk.max_exposure,
        )
    )
    assert result.saving_vs_baseline == 19_600_000
    assert result.exposure_avoided == 340_000_000


# ------------------------------------------------------------ approval timing


def test_bridge_po_approve_by_is_day1_1800(plan):
    bridge = action(plan(B, [SafetyStockConstraint()]), "alternate_supplier")
    assert day_offset(DAY0, bridge.dispatch_by) == (1, "18:00")
    assert day_offset(DAY0, bridge.eta) == (1, "09:00")  # approved at plan time day 0 09:00


def test_late_approval_makes_bridge_infeasible(plan, risk):
    bridge = action(plan(B, [SafetyStockConstraint()]), "alternate_supplier")
    on_time = check_timing(
        TimingCheckRequest(action=bridge, deadline=risk.deadline, at=at(DAY0, 1, "18:00"))
    )
    assert on_time.feasible
    assert day_offset(DAY0, on_time.eta_if_started_at) == (2, "18:00")
    late = check_timing(
        TimingCheckRequest(action=bridge, deadline=risk.deadline, at=at(DAY0, 1, "18:01"))
    )
    assert not late.feasible
    assert day_offset(DAY0, late.latest_start) == (1, "18:00")


def test_plan_after_approve_by_excludes_bridge(plan):
    late = plan(B, [SafetyStockConstraint()], now=at(DAY0, 1, "18:01"))
    assert late.status == "infeasible"
    assert any("V-2002" in e and "lead time" in e for e in late.excluded)
    assert "cannot cover 900" in late.infeasible_reason


def test_transfer_has_dispatch_by(plan):
    t = action(plan(B, [SafetyStockConstraint()]), "stock_transfer")
    assert day_offset(DAY0, t.dispatch_by) == (2, "10:00")  # 8 h transit
    assert day_offset(DAY0, t.eta) == (0, "17:00")


# ------------------------------------------------------------ rejection replan (decision 3)


def test_bridge_rejected_replans_remaining_shortfall_with_air(plan, risk, sapdata):
    """Transfer of 400 already executed; V-2002 excluded; remaining 500 goes to air."""
    after_transfer = [
        {**s, "OnHandQuantity": 400} if s["Plant"] == "DC-BDG" else s for s in sapdata["stock"]
    ]
    remaining = risk.model_copy(update={"shortfall": 500})
    req = build_solve_request(
        risk=remaining,
        material="MG-2L",
        destination="DC-CKR",
        now=NOW,
        strategies=["stock_transfer", "alternate_supplier", "spot_air"],
        constraints=[SafetyStockConstraint(), ExcludeSupplierConstraint(supplier="V-2002")],
        stock=after_transfer,
        lanes=sapdata["lanes"],
        suppliers=sapdata["suppliers"],
        quotes=sapdata["quotes"],
    )
    r = solve(req)
    assert r.status == "optimal"
    assert [a.kind for a in r.actions] == ["spot_air"]
    assert r.total_cost == 31_000_000  # flat price for the remaining 500
    assert "supplier V-2002: excluded by constraint" in r.excluded


def test_infeasible_without_bridge_or_air(plan):
    r = plan(B, [SafetyStockConstraint(), ExcludeSupplierConstraint(supplier="V-2002")])
    assert r.status == "infeasible"
    assert "at most 400 available" in r.infeasible_reason


# ------------------------------------------------------------ other strategies


def test_reschedule_uses_whole_orders_at_full_penalty(plan):
    r = plan(["reschedule_customer"])
    assert sorted(a.reference for a in r.actions) == ["SO-7001", "SO-7002"]
    assert r.total_cost == 340_000_000
    assert all(a.quantity in (700, 300) for a in r.actions)


def test_combined_menu_still_picks_cheapest(plan):
    r = plan(
        ["stock_transfer", "alternate_supplier", "spot_air", "reschedule_customer"],
        [SafetyStockConstraint()],
    )
    assert r.total_cost == 11_400_000


def test_air_delivering_after_deadline_is_excluded(risk):
    req = SolveRequest(
        material="MG-2L",
        destination="DC-CKR",
        required_quantity=900,
        now=NOW,
        deadline=risk.deadline,
        strategies=["spot_air"],
        air_quotes=[
            AirQuote(quote="Q-LATE", price=1, delivery_at=risk.deadline + timedelta(hours=1))
        ],
    )
    r = solve(req)
    assert r.status == "infeasible"
    assert r.excluded == ["air quote Q-LATE: delivers after the deadline"]


# ------------------------------------------------------------ general risk function


@pytest.mark.parametrize(
    "delay,slack,expected",
    [
        (UniformDelay(min_hours=48, max_hours=72), 32, 1.0),
        (UniformDelay(min_hours=48, max_hours=72), 60, 0.5),
        (UniformDelay(min_hours=48, max_hours=72), 72, 0.0),
        (UniformDelay(min_hours=48, max_hours=72), 100, 0.0),
        (FixedDelay(hours=10), 9, 1.0),
        (FixedDelay(hours=10), 10, 0.0),
    ],
)
def test_p_late(delay, slack, expected):
    assert p_late(delay, slack) == pytest.approx(expected)


def _req(cutoff_hours_after_eta, on_hand=200, safety=100):
    eta = DAY0
    cutoff = eta + timedelta(hours=cutoff_hours_after_eta)
    return RiskRequest(
        material="M",
        plant="P",
        on_hand=on_hand,
        safety_stock=safety,
        inbound=[
            InboundSupply(
                ref="PO1",
                quantity=1200,
                eta=eta,
                delay=UniformDelay(min_hours=48, max_hours=72),
            )
        ],
        orders=[
            DemandOrder(order="BIG", quantity=700, cutoff=cutoff, penalty=250),
            DemandOrder(order="SMALL", quantity=300, cutoff=cutoff, penalty=90),
        ],
    )


def test_partial_probability_scales_exposure():
    r = assess(_req(60))
    assert [o.stockout_probability for o in r.orders] == [0.5, 0.5]
    assert r.expected_exposure == 170  # 0.5 × (250 + 90)
    assert r.max_exposure == 340


def test_allocation_protects_higher_penalty_order_first():
    r = assess(_req(32, on_hand=900, safety=100))  # 800 usable, PO surely late
    p = {o.order: o.stockout_probability for o in r.orders}
    assert p == {"BIG": 0.0, "SMALL": 1.0}
    assert r.shortfall == 200
    assert r.max_exposure == 90


def test_no_shortfall_when_inbound_is_on_time():
    r = assess(_req(100))
    assert r.shortfall == 0 and r.deadline is None and r.max_exposure == 0


def test_solver_latency_is_stable(plan):
    """Regression: CBC with threads=1 + timeLimit stalled ~1 in 20 solves for 10 s."""
    import time

    worst = 0.0
    for _ in range(40):
        t0 = time.perf_counter()
        assert plan(B, [SafetyStockConstraint()]).total_cost == 11_400_000
        worst = max(worst, time.perf_counter() - t0)
    assert worst < 2.0
