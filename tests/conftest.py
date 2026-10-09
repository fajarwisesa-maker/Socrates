from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from agent.tools.sap_to_solver import build_risk_request, build_solve_request
from services.sap_mock.app import create_app
from services.sap_mock.seed import reset_store
from services.sap_mock.store import SqliteSapStore
from services.solver.mip import solve
from services.solver.risk import assess
from siaga_common.timeline import day0_for

# Day 0 = Thu 29 Oct 2026, so the day-2 18:00 cutoff falls on Demo Day (Sat 31 Oct).
DAY0_DATE = date(2026, 10, 29)
DAY0 = day0_for(DAY0_DATE)
NOW = DAY0 + timedelta(hours=9)  # case starts day 0 09:00 WIB


@pytest.fixture
def sap_store():
    store = SqliteSapStore(":memory:")
    reset_store(store, DAY0_DATE)
    return store


@pytest.fixture
def sap(sap_store):
    return TestClient(create_app(sap_store, clock=lambda: NOW))


# ---- solver inputs built from the mock SAP, exactly as the agent will ----


def rows(sap, entity_set, **params):
    return sap.get(f"/{entity_set}", params=params).json()["value"]


@pytest.fixture
def sapdata(sap):
    return {
        "stock": rows(sap, "A_MaterialStock"),
        "po_items": rows(sap, "A_PurchaseOrderItem"),
        "sales_orders": rows(sap, "A_SalesOrder"),
        "lanes": rows(sap, "A_TransportLane"),
        "suppliers": rows(sap, "A_Supplier"),
        "quotes": rows(sap, "A_FreightQuote"),
    }


@pytest.fixture
def risk_request(sapdata):
    ckr = next(s for s in sapdata["stock"] if s["Plant"] == "DC-CKR")
    return build_risk_request(
        material="MG-2L",
        plant="DC-CKR",
        stock=ckr,
        po_items=sapdata["po_items"],
        sales_orders=sapdata["sales_orders"],
        affected_refs=["4500018231"],
        delay_hours_min=48,
        delay_hours_max=72,
    )


@pytest.fixture
def risk(risk_request):
    return assess(risk_request)


@pytest.fixture
def plan(risk, sapdata):
    def _plan(strategies, constraints=None, now=NOW, stock=None, request_only=False):
        req = build_solve_request(
            risk=risk,
            material="MG-2L",
            destination="DC-CKR",
            now=now,
            strategies=strategies,
            constraints=constraints,
            stock=stock or sapdata["stock"],
            lanes=sapdata["lanes"],
            suppliers=sapdata["suppliers"],
            quotes=sapdata["quotes"],
        )
        return req if request_only else solve(req)

    return _plan


# ---- agent runtime wired to the in-memory mock SAP, local policy/audit/store/KB ----


@pytest.fixture
def runtime(sap, tmp_path):
    from agent.audit import LocalAuditWriter
    from agent.case_store import SqliteCaseStore
    from agent.clients import HttpSapClient, InProcessSolver
    from agent.runtime import build_runtime
    from siaga_common.settings import Settings

    clock = lambda: NOW  # noqa: E731
    return build_runtime(
        Settings(_env_file=None),
        sap=HttpSapClient(client=sap),
        solver=InProcessSolver(),
        store=SqliteCaseStore(":memory:", clock),
        audit=LocalAuditWriter(tmp_path / "audit", clock),
        clock=clock,
    )


@pytest.fixture
def case(runtime):
    return runtime.store.create_case(case_id="case-test", day0="2026-10-28T17:00:00Z")


@pytest.fixture
def ctx(runtime, case):
    return runtime.context(case.case_id)
