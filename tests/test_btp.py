"""v2 step 1: the mock S/4HANA on SAP BTP (SAP_MOCK_ON_BTP): API key, URL switch, package."""

import httpx
import pytest
from fastapi.testclient import TestClient

from agent.clients import HttpSapClient
from services.sap_mock.app import create_app
from services.sap_mock.seed import reset_store
from services.sap_mock.store import SqliteSapStore
from siaga_common.settings import REPO_ROOT, Settings
from tests.conftest import DAY0_DATE


@pytest.fixture
def store():
    s = SqliteSapStore(":memory:")
    reset_store(s, DAY0_DATE)
    return s


def test_every_endpoint_requires_the_api_key(store):
    c = TestClient(create_app(store, api_key="k-123"))
    for method, path in [
        ("get", "/A_Plant"),
        ("get", "/admin/state"),
        ("post", "/admin/reset"),
        ("get", "/docs"),
    ]:
        r = getattr(c, method)(path)
        assert r.status_code == 401, path
        assert r.json()["error"]["code"] == "Unauthorized"
    assert c.get("/A_Plant", headers={"X-API-Key": "wrong"}).status_code == 401
    assert c.get("/A_Plant", headers={"X-API-Key": "k-123"}).status_code == 200


def test_without_a_key_the_local_mock_stays_open(store):
    assert TestClient(create_app(store, api_key=None)).get("/A_Plant").status_code == 200


def test_the_key_comes_from_the_environment_but_embedded_ignores_it(monkeypatch):
    from services.sap_mock.embedded import embedded_sap
    from siaga_common.settings import get_settings

    monkeypatch.setenv("SAP_MOCK_API_KEY", "env-key")
    get_settings.cache_clear()
    try:
        s = SqliteSapStore(":memory:")
        reset_store(s, DAY0_DATE)
        assert TestClient(create_app(s)).get("/A_Plant").status_code == 401
        client, _ = embedded_sap(DAY0_DATE)
        assert client.query("A_Plant")  # in-process: no key needed
    finally:
        get_settings.cache_clear()


def test_sap_endpoint_switch():
    local = Settings(_env_file=None)
    assert local.sap_endpoint() == ("http://127.0.0.1:8001", {})
    btp = Settings(
        _env_file=None,
        sap_mock_on_btp=True,
        sap_mock_btp_url="https://siaga-sap-mock.cfapps.example.hana.ondemand.com/",
        sap_mock_api_key="k-123",
    )
    assert btp.sap_endpoint() == (
        "https://siaga-sap-mock.cfapps.example.hana.ondemand.com",
        {"X-API-Key": "k-123"},
    )
    with pytest.raises(RuntimeError, match="SAP_MOCK_BTP_URL"):
        Settings(_env_file=None, sap_mock_on_btp=True).sap_endpoint()


def test_http_client_sends_the_key():
    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(200, json={"value": []})

    client = HttpSapClient(
        "https://btp.example",
        headers={"X-API-Key": "k-123"},
        transport=httpx.MockTransport(handler),
    )
    client.query("A_Plant")
    assert seen[0].headers["x-api-key"] == "k-123"
    assert str(seen[0].url).startswith("https://btp.example/A_Plant")


def test_btp_package(tmp_path, monkeypatch):
    import scripts.package_btp as pkg

    monkeypatch.setattr(pkg, "OUT", tmp_path / "btp")
    pkg.main()
    out = tmp_path / "btp"
    manifest = (out / "manifest.yml").read_text(encoding="utf-8")
    for needle in ["memory: 512M", "instances: 1", "python_buildpack", "--port $PORT"]:
        assert needle in manifest
    assert "SAP_MOCK_API_KEY:" not in manifest  # set with cf set-env, never in the file
    assert (out / "runtime.txt").read_text().startswith("python-3.12")
    reqs = (out / "requirements.txt").read_text().splitlines()
    assert all("==" in r for r in reqs) and any(r.startswith("fastapi==") for r in reqs)
    assert len(list((out / "data" / "seed").glob("A_*.json"))) == len(
        list((REPO_ROOT / "data" / "seed").glob("A_*.json"))
    )
    assert not (out / "services" / "sap_mock" / "embedded.py").exists()
    assert not (out / "agent").exists()
