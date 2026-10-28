"""Phase 0 smoke tests: config contract and that the core native deps actually work."""

import os

import pytest

from siaga_common.settings import Settings


def test_defaults(monkeypatch):
    for var in ("AWS_REGION", "LLM_PROVIDER", "MAX_TOOL_CALLS", "MAX_REPLANS"):
        monkeypatch.delenv(var, raising=False)
    s = Settings(_env_file=None)
    assert s.aws_region == "ap-southeast-1"
    assert s.llm_provider == "sap_genai"  # Claude on SAP AI Core; no Bedrock
    assert s.max_tool_calls == 20
    assert s.max_replans == 2
    assert s.verify_delay_seconds == 60


def test_cbc_solver_available():
    import pulp

    x = pulp.LpVariable("trucks", lowBound=0, cat="Integer")
    prob = pulp.LpProblem("smoke", pulp.LpMinimize)
    prob += x
    prob += 250 * x >= 600  # 600 cartons, 250 per truck -> 3 trucks
    prob.solve(pulp.PULP_CBC_CMD(msg=False))
    assert pulp.LpStatus[prob.status] == "Optimal"
    assert x.value() == 3


def test_cedarpy_evaluates():
    import cedarpy

    request = {
        "principal": 'Agent::"siaga"',
        "action": 'Action::"read"',
        "resource": 'Tool::"get_stock"',
        "context": {},
    }
    assert cedarpy.is_authorized(request, "permit(principal, action, resource);", []).allowed
    assert not cedarpy.is_authorized(request, "forbid(principal, action, resource);", []).allowed


@pytest.mark.live
@pytest.mark.skipif(os.getenv("SIAGA_RUN_LIVE_TESTS") != "1", reason="needs SAP AI Core")
def test_sap_ai_core_converse_tool_use():
    from agent.providers import make_sap_genai, ping
    from siaga_common.settings import get_settings

    r = ping(make_sap_genai(get_settings()))
    assert r["tool_use"] and r["model"].startswith("sap:")
