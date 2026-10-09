"""Phase 2 checkpoint: risk + the three solves of brief §2.2, from the seed data.

Reads the seed through an in-memory mock SAP (same OData API the agent uses), builds
solver inputs with agent.tools.sap_to_solver, and runs the solver in-process.
Usage: uv run python scripts/solver_demo.py [--day0 YYYY-MM-DD] [--json]
"""

from __future__ import annotations

import argparse
import json
import warnings
from datetime import date, timedelta

warnings.filterwarnings("ignore", message="Using `httpx` with `starlette.testclient`")

from fastapi.testclient import TestClient  # noqa: E402

from agent.tools.sap_to_solver import build_risk_request, build_solve_request  # noqa: E402
from services.sap_mock.app import create_app  # noqa: E402
from services.sap_mock.seed import reset_store  # noqa: E402
from services.sap_mock.store import SqliteSapStore  # noqa: E402
from services.solver.mip import compare, solve  # noqa: E402
from services.solver.models import CompareRequest, SafetyStockConstraint, SolveResult  # noqa: E402
from services.solver.risk import assess  # noqa: E402
from siaga_common.money import format_idr  # noqa: E402
from siaga_common.timeline import day0_for, display, today_wib  # noqa: E402


def show(title: str, r: SolveResult, day0) -> None:
    print(f"\n== {title}")
    print(
        f"   status={r.status}  total={format_idr(r.total_cost)}  covered={r.covered_quantity}"
        f"/{r.required_quantity}  constraints={[c.type for c in r.constraints] or '-'}"
        f"  ({r.engine}, {r.solve_ms} ms)"
    )
    for a in r.actions:
        trucks = f", {a.trucks} trucks" if a.trucks else ""
        eta = display(day0, a.eta) if a.eta else "-"
        by = f"  start by {display(day0, a.dispatch_by)}" if a.dispatch_by else ""
        print(
            f"   - {a.kind:<18} {a.reference:<10} {a.quantity:>4} ctn{trucks:<10} "
            f"{format_idr(a.cost):>15}  ETA {eta}{by}"
        )
    for s in r.stock_after:
        flag = "  BELOW SAFETY STOCK" if s.on_hand_after < s.safety_stock else ""
        print(f"   stock after: {s.plant} {s.on_hand_after} (safety {s.safety_stock}){flag}")
    for e in r.excluded:
        print(f"   excluded: {e}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--day0", type=date.fromisoformat, default=None)
    ap.add_argument("--json", action="store_true", help="dump raw solver JSON too")
    args = ap.parse_args()
    d0 = args.day0 or today_wib()
    day0, now = day0_for(d0), day0_for(d0) + timedelta(hours=9)

    store = SqliteSapStore(":memory:")
    reset_store(store, d0)
    sap = TestClient(create_app(store, clock=lambda: now))
    get = lambda s: sap.get(f"/{s}").json()["value"]  # noqa: E731
    stock = get("A_MaterialStock")

    risk = assess(
        build_risk_request(
            material="MG-2L",
            plant="DC-CKR",
            stock=next(s for s in stock if s["Plant"] == "DC-CKR"),
            po_items=get("A_PurchaseOrderItem"),
            sales_orders=get("A_SalesOrder"),
            affected_refs=["4500018231"],
            delay_hours_min=48,
            delay_hours_max=72,
        )
    )
    print(f"Case start {display(day0, now)}; delay U[48h, 72h] on PO 4500018231")
    print(
        f"== RISK  usable={risk.usable_stock} demand={risk.demand} shortfall={risk.shortfall}"
        f"  deadline {display(day0, risk.deadline)}"
    )
    for i in risk.inbound:
        print(
            f"   inbound {i.ref}: arrives {display(day0, i.arrival_earliest)} .. "
            f"{display(day0, i.arrival_latest)}"
        )
    for o in risk.orders:
        print(
            f"   {o.order}: P(stockout)={o.stockout_probability:.0%}  penalty "
            f"{format_idr(o.penalty)}"
        )
    print(
        f"   max_exposure={format_idr(risk.max_exposure)}  "
        f"expected_exposure={format_idr(risk.expected_exposure)}"
    )

    def plan(strategies, constraints=None):
        return solve(
            build_solve_request(
                risk=risk,
                material="MG-2L",
                destination="DC-CKR",
                now=now,
                strategies=strategies,
                constraints=constraints,
                stock=stock,
                lanes=get("A_TransportLane"),
                suppliers=get("A_Supplier"),
                quotes=get("A_FreightQuote"),
            )
        )

    a = plan(["spot_air"])
    b1 = plan(["stock_transfer", "alternate_supplier"])
    b2 = plan(["stock_transfer", "alternate_supplier"], [SafetyStockConstraint()])
    show("Option A - air only", a, day0)
    show("Option B - first solve (physical constraints only)", b1, day0)
    show("Option B - replan with safety_stock constraint", b2, day0)
    c = compare(CompareRequest(baseline=a, chosen=b2, max_exposure=risk.max_exposure))
    print(
        f"\n== B (replan) vs A: saving {format_idr(c.saving_vs_baseline)}, "
        f"exposure avoided {format_idr(c.exposure_avoided)}"
    )
    if args.json:
        print(
            json.dumps(
                {
                    "risk": risk.model_dump(mode="json"),
                    "A": a.model_dump(mode="json"),
                    "B1": b1.model_dump(mode="json"),
                    "B2": b2.model_dump(mode="json"),
                },
                indent=2,
            )
        )


if __name__ == "__main__":
    main()
