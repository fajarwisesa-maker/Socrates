"""Phase 0 smoke tests: config contract and that the core native deps actually work."""

import os

import pytest

from siaga_common.settings import Settings


def test_defaults(monkeypatch):
    for var in ("AWS_REGION", "BEDROCK_MODEL_ID", "LLM_PROVIDER", "MAX_TOOL_CALLS", "MAX_REPLANS"):
        monkeypatch.delenv(var, raising=False)
    s = Settings(_env_file=None)
    assert s.aws_region == "ap-southeast-1"
    assert s.max_tool_calls == 20
    assert s.max_replans == 2
    assert s.verify_delay_seconds == 60


def test_model_id_has_no_default(monkeypatch):
    monkeypatch.delenv("BEDROCK_MODEL_ID", raising=False)
    s = Settings(_env_file=None)
    assert s.bedrock_model_id is None
    with pytest.raises(RuntimeError, match="BEDROCK_MODEL_ID"):
        s.require_model_id()


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


@pytest.mark.aws
@pytest.mark.skipif(os.getenv("SIAGA_RUN_AWS_TESTS") != "1", reason="needs AWS credentials")
def test_bedrock_converse_tool_use():
    from scripts.aws_check import converse_ping
    from siaga_common.settings import get_settings

    s = get_settings()
    r = converse_ping(s.aws_region, s.require_model_id())
    assert r["tool_use"] and r["tool_use"]["input"] == {"status": "ok"}
