"""v2 step 3: SAP RPT-1.6 delay prediction, combined with the signal range in code.

AI Core is simulated with httpx.MockTransport answering in the SDK's response shape
(tests/fixtures/rpt_response_demo.json, a labelled synthetic fixture), so the real client
code runs: OAuth, URL, headers, body, parsing, timeout.
"""

import json
from collections.abc import Callable

import httpx
import pytest

from agent.delay_model import (
    DISAGREE,
    PLACEHOLDER,
    FakePredictor,
    Prediction,
    PredictionUnavailable,
    RecordingPredictor,
    ReplayPredictor,
    RptPredictor,
    combine,
    load_history,
    parse_response,
    query_row,
    request_body,
)
from agent.factory import make_agent
from agent.providers.fake import FakeProvider
from agent.providers.scripts import golden_scripts
from agent.signals import build_signals
from siaga_common.settings import REPO_ROOT, Settings
from tests.conftest import NOW

DEMO = REPO_ROOT / "data" / "demo"
HISTORY = REPO_ROOT / "data" / "history" / "disruptions.csv"
FIXTURE = json.loads((REPO_ROOT / "tests" / "fixtures" / "rpt_response_demo.json").read_text())
QUERY = {
    "cause": "flood",
    "corridor": "Pantura",
    "month": 10,
    "rain_level": None,
    "signal_sources": 2,
    "official_notice": "y",
}


def ai_core(
    answer: Callable[[httpx.Request], httpx.Response], seen: list[httpx.Request] | None = None
) -> httpx.MockTransport:
    """Token endpoint + the predict endpoint, recording requests."""

    def handler(req: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(req)
        if req.url.path.endswith("/oauth/token"):
            return httpx.Response(200, json={"access_token": "tok-123", "expires_in": 3600})
        return answer(req)

    return httpx.MockTransport(handler)


def rpt(transport: httpx.MockTransport, timeout: float = 5.0) -> RptPredictor:
    return RptPredictor(
        auth_url="https://sub.authentication.example.hana.ondemand.com",
        client_id="client",
        client_secret="secret",
        api_url="https://api.ai.example.ml.hana.ondemand.com",
        deployment_id="d123",
        resource_group="default",
        history=load_history(HISTORY),
        timeout=timeout,
        transport=transport,
    )


def answering(payload: dict) -> Callable[[httpx.Request], httpx.Response]:
    return lambda req: httpx.Response(200, json=payload)


def with_prediction(value: float, interval=None) -> dict:
    p = json.loads(json.dumps(FIXTURE))
    p["predictions"][0]["delay_hours"][0]["prediction"] = value
    p["predictions"][0]["delay_hours"][0]["confidence_interval"] = interval
    return p


# ------------------------------------------------------------ data and request shape


def test_history_is_80_labelled_synthetic_rows():
    head = HISTORY.read_text(encoding="utf-8").splitlines()[0]
    assert head.startswith("# SYNTHETIC DATA")
    rows = load_history(HISTORY)
    assert len(rows) == 80
    assert {r["cause"] for r in rows} <= {
        "flood", "landslide", "road_closure", "port_strike", "accident", "festive_congestion",
    }  # fmt: skip
    assert all(r["delay_hours"] > 0 for r in rows)


def test_request_body_matches_the_rpt_api():
    body = request_body(load_history(HISTORY), QUERY)
    assert body["prediction_config"]["target_columns"] == [
        {"name": "delay_hours", "prediction_placeholder": PLACEHOLDER, "task_type": "regression"}
    ]
    assert body["index_column"] == "id"
    assert len(body["rows"]) == 81
    assert body["rows"][-1] == {"id": "QUERY", **QUERY, "delay_hours": "[PREDICT]"}


def test_query_row_comes_from_the_case_not_the_model():
    signals = build_signals("banjir", DEMO / "forwarder_notice.pdf")
    q = query_row(
        {"cause": "flood", "lane": "SMG-JKT"}, signals, "2026-10-29T02:00:00Z"
    )  # 09:00 WIB, October
    assert q == QUERY


def test_parse_response():
    assert parse_response(FIXTURE) == (61.3, (52.4, 70.1))
    with pytest.raises(ValueError):
        parse_response({**FIXTURE, "status": {"code": 3, "message": "bad data"}})


# ------------------------------------------------------------ the rule (agreed 25 Oct)


def pred(value: float) -> Prediction:
    return Prediction(provider="rpt", model="SAP RPT-1.6", prediction=value, history_rows=80)


def test_inside_the_signal_range_the_prediction_is_used():
    out = combine(pred(61.3), 48, 72, QUERY)
    assert out["used"] == "prediction" and out["delay_for_risk_hours"] == [61.3, 61.3]
    assert not out["disagree"] and out["flag"] is None


@pytest.mark.parametrize(("value", "used"), [(30.0, 48), (90.0, 72)])
def test_outside_the_range_it_is_clamped_and_flagged(value, used):
    out = combine(pred(value), 48, 72, QUERY)
    assert out["used"] == "clamped" and out["delay_for_risk_hours"] == [used, used]
    assert out["disagree"] and out["flag"] == DISAGREE
    assert out["predicted_hours"] == value  # the model's own number is kept, for the audit


def test_unavailable_uses_the_signal_range():
    out = combine(None, 48, 72, QUERY, "no answer within 5 s")
    assert out["status"] == "unavailable" and out["delay_for_risk_hours"] == [48, 72]


# ------------------------------------------------------------ the AI Core client


def test_client_calls_ai_core_as_documented():
    seen: list[httpx.Request] = []
    p = rpt(ai_core(answering(FIXTURE), seen))
    out = p.predict("case-1", QUERY)
    assert (out.prediction, out.interval, out.model) == (61.3, (52.4, 70.1), "SAP RPT-1.6")
    token, call = seen
    assert str(token.url) == "https://sub.authentication.example.hana.ondemand.com/oauth/token"
    assert token.headers["authorization"].startswith("Basic ")
    assert b"grant_type=client_credentials" in token.content
    assert str(call.url) == (
        "https://api.ai.example.ml.hana.ondemand.com/v2/inference/deployments/d123/predict"
    )
    assert call.headers["authorization"] == "Bearer tok-123"
    assert call.headers["ai-resource-group"] == "default"
    assert json.loads(call.content)["rows"][-1]["delay_hours"] == "[PREDICT]"
    p.predict("case-2", QUERY)  # the token is cached
    assert len([r for r in seen if r.url.path.endswith("/oauth/token")]) == 1


def test_timeout_and_errors_become_unavailable():
    def slow(req):
        raise httpx.ReadTimeout("timed out", request=req)

    with pytest.raises(PredictionUnavailable, match="within 5 s"):
        rpt(ai_core(slow)).predict("c", QUERY)
    with pytest.raises(PredictionUnavailable, match="HTTP 500"):
        rpt(ai_core(lambda r: httpx.Response(500, text="boom"))).predict("c", QUERY)
    with pytest.raises(PredictionUnavailable):
        rpt(ai_core(answering({"predictions": []}))).predict("c", QUERY)


def test_record_then_replay_without_network(tmp_path):
    path = tmp_path / "rpt.jsonl"
    rec = RecordingPredictor(rpt(ai_core(answering(FIXTURE))), path)
    first = rec.predict("case-a", QUERY)
    replay = ReplayPredictor(path)
    assert replay.predict("case-b", QUERY) == first  # served per case, in order
    with pytest.raises(PredictionUnavailable, match="left the recorded path"):
        replay.predict("case-b", QUERY)


# ------------------------------------------------------------ in the agent


@pytest.fixture
def signals():
    return build_signals(
        (DEMO / "whatsapp_driver.txt").read_text(encoding="utf-8"), DEMO / "forwarder_notice.pdf"
    )


def build(sap, tmp_path, orchestration: str, predictor):
    from agent.audit import LocalAuditWriter
    from agent.case_store import SqliteCaseStore
    from agent.clients import HttpSapClient, InProcessSolver
    from agent.runtime import build_runtime

    clock = lambda: NOW  # noqa: E731
    return build_runtime(
        Settings(_env_file=None, orchestration=orchestration, delay_model="rpt"),
        sap=HttpSapClient(client=sap),
        solver=InProcessSolver(),
        store=SqliteCaseStore(":memory:", clock),
        audit=LocalAuditWriter(tmp_path / "audit", clock),
        clock=clock,
        delay_model=predictor,
    )


def run(rt, signals):
    agent = make_agent(rt, FakeProvider(golden_scripts()))
    case = agent.start_case(signals, day0="2026-10-28T17:00:00Z")
    return agent, agent.run(case.case_id)


def golden_numbers_hold(c):
    assert c.status == "AWAITING_APPROVAL", c.escalation_reason
    assert c.risk["max_exposure"] == c.risk["expected_exposure"] == 340_000_000
    assert c.risk["shortfall"] == 900
    assert all(o["stockout_probability"] == 1.0 for o in c.risk["orders"])
    assert c.summary["chosen_cost"] == 11_400_000
    assert c.summary["saving_vs_baseline"] == 19_600_000


@pytest.mark.parametrize("orchestration", ["single", "multi"])
def test_prediction_flows_into_risk_and_keeps_the_golden_numbers(
    sap, tmp_path, signals, orchestration
):
    rt = build(sap, tmp_path, orchestration, rpt(ai_core(answering(FIXTURE))))
    agent, c = run(rt, signals)
    golden_numbers_hold(c)
    p = c.delay_prediction
    assert (p["status"], p["used"], p["delay_for_risk_hours"]) == ("ok", "prediction", [61.3, 61.3])
    assert p["interval_hours"] == [52.4, 70.1] and p["history_rows"] == 80
    # the delayed PO's arrival is now a point: day 1 10:00 + 61.3 h, after the day-2 cutoff
    inbound = c.risk["inbound"][0]
    assert inbound["arrival_earliest"] == inbound["arrival_latest"]
    events = rt.store.list_events(c.case_id)
    assert any(e.title.startswith("Delay predicted by SAP RPT-1.6: 61.3 h") for e in events)
    assessed = next(e for e in events if e.stage == "ASSESS" and e.status == "completed")
    assert assessed.data["delay_prediction"]["used"] == "prediction"
    audit = rt.audit.read(c.case_id)
    assert any(e.kind == "delay_prediction" and e.payload["response"] for e in audit)
    agent.decide(c.case_id, next(a for a in c.actions if a.get("approval_id"))["approval_id"],
                 True, by="planner")  # fmt: skip
    assert agent.verify(c.case_id).status == "RESOLVED"


def test_impact_agent_calls_predict_delay_itself(sap, tmp_path, signals):
    rt = build(sap, tmp_path, "multi", rpt(ai_core(answering(FIXTURE))))
    _, c = run(rt, signals)
    calls = [
        (e.agent, e.data["tool"]) for e in rt.store.list_events(c.case_id) if e.status == "tool"
    ]
    assert ("Impact Agent", "predict_delay") in calls
    assert calls.index(("Impact Agent", "predict_delay")) < calls.index(
        ("Impact Agent", "compute_risk")
    )


def test_disagreement_is_clamped_and_numbers_still_hold(sap, tmp_path, signals):
    rt = build(sap, tmp_path, "multi", rpt(ai_core(answering(with_prediction(30.0)))))
    _, c = run(rt, signals)
    golden_numbers_hold(c)  # 48 h is still past the 32 h of slack before the cutoff
    assert c.delay_prediction["flag"] == DISAGREE
    assert c.delay_prediction["delay_for_risk_hours"] == [48, 48]


@pytest.mark.parametrize("orchestration", ["single", "multi"])
def test_timeout_falls_back_to_the_signal_range(sap, tmp_path, signals, orchestration):
    def slow(req):
        raise httpx.ReadTimeout("timed out", request=req)

    rt = build(sap, tmp_path, orchestration, rpt(ai_core(slow)))
    _, c = run(rt, signals)
    golden_numbers_hold(c)
    assert c.delay_prediction["status"] == "unavailable"
    assert c.delay_prediction["delay_for_risk_hours"] == [48, 72]
    note = next(
        e for e in rt.store.list_events(c.case_id) if e.title.startswith("Prediction unavailable")
    )
    assert note.status == "info"  # neutral, not an error
    assert "within 5 s" in note.detail


def test_fake_stand_in_is_labelled_not_rpt():
    p = FakePredictor(load_history(HISTORY)).predict("c", QUERY)
    assert "not RPT" in p.model and p.provider == "fake"
    assert 48 <= p.prediction <= 72


def test_recorded_rpt_answer_keeps_the_golden_numbers(sap, tmp_path, signals):
    """Once `DELAY_MODEL=rpt make record-golden` has run against AI Core."""
    path = REPO_ROOT / "data" / "golden" / "multi" / "rpt.jsonl"
    entries = [json.loads(x) for x in path.read_text().splitlines()] if path.exists() else []
    if not any(e.get("prediction", {}).get("provider") == "rpt" for e in entries):
        pytest.skip("no recorded SAP RPT-1.6 answer yet (needs SAP AI Core access)")
    rt = build(sap, tmp_path, "multi", ReplayPredictor(path))
    _, c = run(rt, signals)
    golden_numbers_hold(c)
    assert c.delay_prediction["status"] == "ok"
