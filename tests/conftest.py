from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from services.sap_mock.app import create_app
from services.sap_mock.seed import reset_store
from services.sap_mock.store import SqliteSapStore
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
