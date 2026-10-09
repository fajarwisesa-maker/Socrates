"""An in-process mock S/4HANA reached through the same HTTP client code as the real one."""

from __future__ import annotations

import warnings
from collections.abc import Callable
from datetime import date, datetime

from services.sap_mock.seed import reset_store
from services.sap_mock.store import SqliteSapStore


def embedded_sap(
    day0: date | None = None, clock: Callable[[], datetime] | None = None
) -> tuple[object, SqliteSapStore]:
    """Return (HttpSapClient over an in-memory mock, its store)."""
    warnings.filterwarnings("ignore", message="Using `httpx` with `starlette.testclient`")
    from fastapi.testclient import TestClient

    from agent.clients import HttpSapClient
    from services.sap_mock.app import create_app

    store = SqliteSapStore(":memory:")
    reset_store(store, day0)
    return HttpSapClient(client=TestClient(create_app(store, clock=clock))), store
