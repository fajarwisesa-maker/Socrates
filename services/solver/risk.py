"""Stockout probability and exposure: delay distribution vs loading cutoff.

For an inbound shipment with original ETA `eta` and random delay D, it is late for a
cutoff when eta + D > cutoff, i.e. D > slack with slack = cutoff - eta.

For each order, every combination of inbound shipments being on time / late (w.r.t. that
order's cutoff) is enumerated, assuming independent delays. In each scenario the stock
available by the cutoff (usable stock + on-time inbound) is allocated to orders due by
that cutoff in priority order (earlier cutoff first, then higher penalty). An order is
missed when it cannot be filled in full (OTIF). P(stockout) is the probability mass of
the scenarios in which it is missed.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from itertools import product

from services.solver.models import (
    DelayDistribution,
    DemandOrder,
    FixedDelay,
    InboundRisk,
    InboundSupply,
    OrderRisk,
    RiskRequest,
    RiskResult,
    UniformDelay,
)

MAX_ENUMERATED_SHIPMENTS = 12  # 4096 scenarios per order


def p_late(delay: DelayDistribution, slack_hours: float) -> float:
    """P(D > slack) for the delay distribution."""
    if isinstance(delay, UniformDelay):
        lo, hi = delay.min_hours, delay.max_hours
        if slack_hours < lo:
            return 1.0
        if slack_hours >= hi:
            return 0.0
        return (hi - slack_hours) / (hi - lo)
    if isinstance(delay, FixedDelay):
        return 1.0 if delay.hours > slack_hours else 0.0
    return 1.0 if slack_hours < 0 else 0.0  # no delay: late only if already past cutoff


def _arrival_window(s: InboundSupply) -> tuple[datetime, datetime]:
    d = s.delay
    if isinstance(d, UniformDelay):
        return s.eta + timedelta(hours=d.min_hours), s.eta + timedelta(hours=d.max_hours)
    if isinstance(d, FixedDelay):
        at = s.eta + timedelta(hours=d.hours)
        return at, at
    return s.eta, s.eta


def _priority(o: DemandOrder) -> tuple[datetime, int, str]:
    return (o.cutoff, -o.penalty, o.order)


def _missed(order: DemandOrder, orders: list[DemandOrder], available: int) -> bool:
    """Allocate `available` to orders due by this order's cutoff, in priority order."""
    for o in sorted((o for o in orders if o.cutoff <= order.cutoff), key=_priority):
        if o.quantity <= available:
            available -= o.quantity
            if o.order == order.order:
                return False
        elif o.order == order.order:
            return True
    return True  # unreachable: order is always in its own list


def stockout_probability(order: DemandOrder, req: RiskRequest) -> float:
    usable = max(req.on_hand - req.safety_stock, 0)
    late = []
    for s in req.inbound:
        slack = (order.cutoff - s.eta).total_seconds() / 3600
        late.append(p_late(s.delay, slack))
    uncertain = [i for i, p in enumerate(late) if 0.0 < p < 1.0]
    if len(uncertain) > MAX_ENUMERATED_SHIPMENTS:
        raise ValueError(f"too many uncertain inbound shipments ({len(uncertain)})")
    certain_on_time = sum(s.quantity for s, p in zip(req.inbound, late, strict=True) if p == 0.0)

    total = 0.0
    for outcome in product((False, True), repeat=len(uncertain)):  # True = late
        prob, arriving = 1.0, certain_on_time
        for i, is_late in zip(uncertain, outcome, strict=True):
            prob *= late[i] if is_late else 1.0 - late[i]
            if not is_late:
                arriving += req.inbound[i].quantity
        if _missed(order, req.orders, usable + arriving):
            total += prob
    return round(total, 6)


def assess(req: RiskRequest) -> RiskResult:
    usable = max(req.on_hand - req.safety_stock, 0)
    orders = sorted(req.orders, key=_priority)

    order_risks = []
    for o in orders:
        p = stockout_probability(o, req)
        order_risks.append(
            OrderRisk(
                order=o.order,
                quantity=o.quantity,
                cutoff=o.cutoff,
                penalty=o.penalty,
                stockout_probability=p,
                expected_exposure=round(p * o.penalty),
            )
        )

    # Shortfall per cutoff assuming every at-risk inbound misses (only shipments certain
    # to arrive in time count); the deadline is the earliest cutoff with a shortfall.
    shortfall, deadline = 0, None
    for cutoff in sorted({o.cutoff for o in orders}):
        due = sum(o.quantity for o in orders if o.cutoff <= cutoff)
        sure = sum(
            s.quantity
            for s in req.inbound
            if p_late(s.delay, (cutoff - s.eta).total_seconds() / 3600) == 0.0
        )
        gap = max(due - usable - sure, 0)
        if gap > 0 and deadline is None:
            deadline = cutoff
        shortfall = max(shortfall, gap)

    inbound = [
        InboundRisk(ref=s.ref, quantity=s.quantity, arrival_earliest=a, arrival_latest=b)
        for s in req.inbound
        for a, b in [_arrival_window(s)]
    ]
    return RiskResult(
        usable_stock=usable,
        demand=sum(o.quantity for o in orders),
        shortfall=shortfall,
        deadline=deadline,
        orders=order_risks,
        inbound=inbound,
        max_exposure=sum(r.penalty for r in order_risks if r.stockout_probability > 0),
        expected_exposure=sum(r.expected_exposure for r in order_risks),
    )
