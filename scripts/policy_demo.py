"""Phase 3 checkpoint: the three policy cases against an in-memory mock SAP.

Usage: uv run python scripts/policy_demo.py
"""

from __future__ import annotations

import tempfile
import warnings
from datetime import date, timedelta
from pathlib import Path

warnings.filterwarnings("ignore", message="Using `httpx` with `starlette.testclient`")

from fastapi.testclient import TestClient  # noqa: E402

from agent.audit import LocalAuditWriter  # noqa: E402
from agent.case_store import SqliteCaseStore  # noqa: E402
from agent.clients import HttpSapClient, InProcessSolver  # noqa: E402
from agent.runtime import build_runtime  # noqa: E402
from services.sap_mock.app import create_app  # noqa: E402
from services.sap_mock.seed import reset_store  # noqa: E402
from services.sap_mock.store import SqliteSapStore  # noqa: E402
from siaga_common.settings import Settings  # noqa: E402
from siaga_common.timeline import day0_for  # noqa: E402


def show(label, r):
    print(f"\n# {label}")
    print(f"  status={r.status} tier={r.tier} call#{r.call_index}")
    if r.denial:
        print(f"  denied by {r.denial.policies}: {r.denial.message}")
    if r.output:
        keys = ("StockTransfer", "FreightCostIDR", "PurchaseOrder", "YY1_Status", "approval_id")
        print("  output:", {k: r.output[k] for k in keys if k in r.output})


def main() -> None:
    d0 = date(2026, 10, 29)
    now = day0_for(d0) + timedelta(hours=9)
    sap_store = SqliteSapStore(":memory:")
    reset_store(sap_store, d0)
    sap = TestClient(create_app(sap_store, clock=lambda: now))
    audit_dir = Path(tempfile.mkdtemp()) / "audit"
    rt = build_runtime(
        Settings(_env_file=None),
        sap=HttpSapClient(client=sap),
        solver=InProcessSolver(),
        store=SqliteCaseStore(":memory:", lambda: now),
        audit=LocalAuditWriter(audit_dir, lambda: now),
        clock=lambda: now,
    )
    case = rt.store.create_case(case_id="case-policy-demo")
    ctx = rt.context(case.case_id)
    transfer = {"material": "MG-2L", "from_plant": "DC-BDG", "to_plant": "DC-CKR",
                "quantity": 400, "trucks": 2}  # fmt: skip
    po = {"supplier": "V-2002", "material": "MG-2L", "plant": "DC-CKR", "quantity": 500}

    show("1. Tier 2 transfer, 400 ctn / 2 trucks (Rp 3.9M)",
         rt.registry.invoke(ctx, "execute_stock_transfer", transfer))  # fmt: skip
    show("2a. Tier 3 bridge PO without approval",
         rt.registry.invoke(ctx, "create_purchase_order", po))  # fmt: skip
    req = rt.registry.invoke(ctx, "request_human_approval",
                             {"tool": "create_purchase_order", "args": po, "card": {}})  # fmt: skip
    show("2b. approval requested", req)
    rt.store.decide_approval(req.output["approval_id"], True, by="planner")
    show("2c. same PO after the planner approved",
         rt.registry.invoke(ctx, "create_purchase_order", po))  # fmt: skip
    lane = sap_store.get("A_TransportLane", "BDG-CKR")
    sap_store.put("A_TransportLane", {**lane, "CostPerTruckIDR": 20_000_000})
    show("3. transfer at Rp 20M/truck x 3 = Rp 60M",
         rt.registry.invoke(ctx, "execute_stock_transfer", {**transfer, "trucks": 3}))  # fmt: skip

    print(f"\n# audit trail {audit_dir}/{case.case_id}.jsonl")
    for e in rt.audit.read(case.case_id):
        p = e.payload
        extra = (
            f"allowed={p['allowed']} {p['policies']}"
            if e.kind == "policy_decision"
            else p.get("status", p.get("event", ""))
        )
        print(f"  {e.seq:>2} {e.kind:<16} {p.get('tool', ''):<24} {extra:<40} {e.hash[:12]}")
    print("  verify:", rt.audit.verify(case.case_id))


if __name__ == "__main__":
    main()
