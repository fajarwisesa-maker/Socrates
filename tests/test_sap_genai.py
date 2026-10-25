"""LLM_PROVIDER=sap_genai (Claude on SAP AI Core) and LLM_FALLBACK=sap_genai.

AI Core is simulated with httpx.MockTransport in the shape SAP's SDK uses (agent/aicore.py):
OAuth token, `GET /v2/lm/deployments?scenarioId=foundation-models&status=RUNNING`, and the
Bedrock Converse body posted to `{deploymentUrl}/converse`. Its model answers come from the
same fake scripts the other tests use, so a whole demo case runs over the wire format.
"""

from __future__ import annotations

import contextvars
import json

import httpx
import pytest
from botocore.exceptions import ClientError

from agent.aicore import AiCore, AiCoreError
from agent.factory import make_agent
from agent.providers import make_provider
from agent.providers.base import LLMError, LLMRequest, user_text
from agent.providers.bedrock import BedrockProvider, error_kind
from agent.providers.fake import FakeProvider
from agent.providers.fallback import FallbackProvider
from agent.providers.replay import RecordingProvider, ReplayProvider
from agent.providers.sap_genai import SapGenAIProvider
from agent.signals import build_signals
from siaga_common.settings import REPO_ROOT, Settings
from tests.conftest import NOW

DEMO = REPO_ROOT / "data" / "demo"
MODEL = "anthropic--claude-4.6-sonnet"
DEPLOY_URL = "https://api.ai.example.com/v2/inference/deployments/dclaude"
REQ = LLMRequest(
    purpose="perceive",
    system="sys",
    messages=[user_text("hi")],
    tools=[{"toolSpec": {"name": "t", "description": "d", "inputSchema": {"json": {}}}}],
)
OK = {
    "output": {"message": {"role": "assistant", "content": [{"text": "ok"}]}},
    "stopReason": "end_turn",
    "usage": {"inputTokens": 3, "outputTokens": 1},
    "metrics": {"latencyMs": 12},
}
DEPLOYMENTS = {
    "count": 3,
    "resources": [
        {"id": "dgpt", "deploymentUrl": "https://x/dgpt", "configurationId": "c1",
         "details": {"resources": {"backend_details": {"model": {"name": "gpt-5"}}}}},
        {"id": "dold", "deploymentUrl": "https://x/dold", "configurationId": "c2"},
        {"id": "dclaude", "deploymentUrl": DEPLOY_URL, "configurationId": "c3",
         "details": {"resources": {"backend_details": {"model": {"name": MODEL, "version": "1"}}}}},
    ],
}  # fmt: skip

_current: contextvars.ContextVar[LLMRequest] = contextvars.ContextVar("req")


class AiCoreSim:
    """Token + deployments + /converse. `converse_answers` are Converse JSON dicts or ints
    (an HTTP status to fail with); with `model`, answers come from that provider instead."""

    def __init__(self, converse_answers=None, model=None):
        self.answers = list(converse_answers or [])
        self.model = model
        self.calls: list[httpx.Request] = []
        self.tokens = 0

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.calls.append(req)
        path = req.url.path
        if path.endswith("/oauth/token"):
            self.tokens += 1
            return httpx.Response(
                200, json={"access_token": f"tok{self.tokens}", "expires_in": 3600}
            )
        if path == "/v2/lm/deployments":
            assert req.url.params["scenarioId"] == "foundation-models"
            assert req.url.params["status"] == "RUNNING"
            return httpx.Response(200, json=DEPLOYMENTS)
        if path == "/v2/lm/configurations/c2":
            return httpx.Response(
                200, json={"parameterBindings": [{"key": "modelName", "value": "old-model"}]}
            )
        if str(req.url) == f"{DEPLOY_URL}/converse":
            assert req.headers["AI-Resource-Group"] == "default"
            assert req.headers["Authorization"].startswith("Bearer tok")
            body = json.loads(req.content)
            assert "modelId" not in body
            if self.model is not None:  # answer like the model would, from the fake scripts
                sent = _current.get()
                expected = BedrockProvider.__new__(BedrockProvider)
                expected.model_id, expected.temperature = "", 0.0
                want = expected._kwargs(sent)
                del want["modelId"]
                assert body == json.loads(json.dumps(want))  # the Bedrock Converse body
                r = self.model.converse(sent)
                return httpx.Response(200, json={
                    "output": {"message": r.message}, "stopReason": r.stop_reason,
                    "usage": {"inputTokens": 10, "outputTokens": 5}, "metrics": {"latencyMs": 40},
                })  # fmt: skip
            a = self.answers.pop(0)
            return (
                httpx.Response(a, text="err") if isinstance(a, int) else httpx.Response(200, json=a)
            )
        return httpx.Response(404, json={"error": f"unexpected {req.method} {req.url}"})


class WireSap(SapGenAIProvider):
    """Passes the request to the simulator out of band, so it can answer per purpose."""

    def converse(self, req, on_retry=None):
        token = _current.set(req)
        try:
            return super().converse(req, on_retry)
        finally:
            _current.reset(token)


def aicore(sim) -> AiCore:
    return AiCore("https://auth.example.com", "cid", "csecret", "https://api.ai.example.com",
                  transport=httpx.MockTransport(sim))  # fmt: skip


def provider(sim, **kw) -> SapGenAIProvider:
    return WireSap(aicore(sim), MODEL, sleep=lambda s: None, **kw)


# --- the endpoint ---------------------------------------------------------------------


def test_finds_the_deployment_by_model_name_and_calls_converse():
    sim = AiCoreSim([OK])
    p = provider(sim)
    resp = p.converse(REQ)
    assert resp.text() == "ok" and resp.model == f"sap:{MODEL}" and resp.latency_ms == 12
    post = sim.calls[-1]
    assert str(post.url) == f"{DEPLOY_URL}/converse"
    body = json.loads(post.content)
    assert body["system"] == [{"text": "sys"}]
    assert body["toolConfig"]["toolChoice"] == {"auto": {}}
    assert body["inferenceConfig"] == {"maxTokens": 4096, "temperature": 0.0}
    sim.answers.append(OK)
    p.converse(REQ)
    assert sum(c.url.path == "/v2/lm/deployments" for c in sim.calls) == 1  # URL cached
    assert sim.tokens == 1  # token cached


def test_deployment_errors_name_what_was_found():
    sim = AiCoreSim()
    with pytest.raises(AiCoreError) as e:
        aicore(sim).deployment_url("anthropic--claude-9-sonnet")
    assert "gpt-5" in str(e.value) and "old-model" in str(e.value) and MODEL in str(e.value)
    with pytest.raises(LLMError) as e:
        WireSap(aicore(sim), "anthropic--claude-9-sonnet").converse(REQ)
    assert e.value.kind == "account"


def test_retries_refresh_and_errors():
    retries = []
    p = provider(AiCoreSim([429, 503, OK]))
    assert p.converse(REQ, lambda *a: retries.append(a)).text() == "ok"
    assert [r[3] for r in retries] == ["throttled", "HTTP 503"]
    sim = AiCoreSim([401, OK])
    assert provider(sim).converse(REQ).text() == "ok" and sim.tokens == 2  # token refreshed once
    for status, kind in ((403, "account"), (400, "other")):
        with pytest.raises(LLMError) as e:
            provider(AiCoreSim([status])).converse(REQ)
        assert e.value.kind == kind
    with pytest.raises(LLMError) as e:
        provider(AiCoreSim([429, 429]), max_attempts=2).converse(REQ)
    assert e.value.kind == "throttle"


def test_temperature_dropped_once_if_rejected():
    sim = AiCoreSim([400, OK])
    p = provider(sim)

    def handler(req):
        if str(req.url).endswith("/converse") and sim.answers and sim.answers[0] == 400:
            sim.answers.pop(0)
            return httpx.Response(400, text="temperature is not supported for this model")
        return sim(req)

    p.aicore = aicore(handler)
    assert p.converse(REQ).text() == "ok" and p.temperature is None


def test_missing_aicore_settings_are_named():
    with pytest.raises(RuntimeError) as e:
        make_provider(Settings(_env_file=None, LLM_PROVIDER="sap_genai", AICORE_CLIENT_ID="x"))
    assert "AICORE_AUTH_URL" in str(e.value) and "AICORE_CLIENT_ID" not in str(e.value)


def test_factory_wraps_bedrock_with_the_sap_fallback(monkeypatch):
    s = Settings(
        _env_file=None, LLM_PROVIDER="bedrock", BEDROCK_MODEL_ID="m", LLM_FALLBACK="sap_genai",
        AICORE_AUTH_URL="https://a", AICORE_CLIENT_ID="c", AICORE_CLIENT_SECRET="s",
        AICORE_API_URL="https://api",
    )  # fmt: skip
    p = make_provider(s)
    assert isinstance(p, FallbackProvider) and p.name == "bedrock+fallback:sap_genai"
    assert p.primary.max_attempts == 2 and p.fallback.model_name == MODEL


# --- Bedrock error kinds and the fallback ----------------------------------------------


def client_error(code, msg):
    return ClientError({"Error": {"Code": code, "Message": msg}}, "Converse")


@pytest.mark.parametrize(
    "code,msg,kind",
    [
        ("ValidationException", "Operation not allowed", "account"),
        ("AccessDeniedException", "You don't have access to the model", "account"),
        ("UnrecognizedClientException", "The security token is invalid", "account"),
        ("ThrottlingException", "Too many requests", "throttle"),
        ("ValidationException", "messages: field required", "other"),
    ],
)  # fmt: skip
def test_bedrock_error_kinds(code, msg, kind):
    assert error_kind(code, msg) == kind


class Raising:
    name = "bedrock"

    def __init__(self, errors):
        self.errors, self.calls = list(errors), 0

    def converse(self, req, on_retry=None):
        self.calls += 1
        e = self.errors.pop(0) if self.errors else None
        if e:
            raise e
        say = {"role": "assistant", "content": [{"text": "bedrock"}]}
        return FakeProvider({"perceive": lambda r, n: say}).converse(req)


def test_fallback_moves_a_case_at_its_start_only():
    sap = provider(AiCoreSim([OK, OK, OK]))
    fb = FallbackProvider(
        Raising([LLMError("Bedrock ValidationException: Operation not allowed", "account")]), sap
    )
    r1 = fb.converse(REQ.model_copy(update={"case_id": "a"}))
    assert r1.model == f"sap:{MODEL}" and "account error" in r1.fallback_reason
    r2 = fb.converse(REQ.model_copy(update={"case_id": "a"}))  # stays on SAP for the case
    assert r2.fallback_reason and fb.primary.calls == 1
    # another case tries Bedrock again
    assert fb.converse(REQ.model_copy(update={"case_id": "b"})).text() == "bedrock"
    # once a case had a Bedrock answer, a later account error escalates as usual
    fb.primary.errors = [LLMError("Bedrock AccessDeniedException: no", "account")]
    with pytest.raises(LLMError):
        fb.converse(REQ.model_copy(update={"case_id": "b"}))
    # errors that are not about the account or throttling never move a case
    fb.primary.errors = [LLMError("Bedrock ValidationException: bad request", "other")]
    with pytest.raises(LLMError):
        fb.converse(REQ.model_copy(update={"case_id": "c"}))


def test_fallback_answers_are_recorded_and_replayed(tmp_path):
    fb = FallbackProvider(
        Raising([LLMError("throttled after 2 attempts", "throttle")]), provider(AiCoreSim([OK]))
    )
    rec = RecordingProvider(fb, tmp_path / "llm.jsonl")
    first = rec.converse(REQ.model_copy(update={"case_id": "a"}))
    again = ReplayProvider(tmp_path / "llm.jsonl").converse(REQ.model_copy(update={"case_id": "z"}))
    assert again.fallback_reason == first.fallback_reason and again.model == f"replay:sap:{MODEL}"


# --- whole demo cases over the wire ---------------------------------------------------


def build(sap, tmp_path, **settings):
    from agent.audit import LocalAuditWriter
    from agent.case_store import SqliteCaseStore
    from agent.clients import HttpSapClient, InProcessSolver
    from agent.runtime import build_runtime

    clock = lambda: NOW  # noqa: E731
    return build_runtime(
        Settings(_env_file=None, **settings),
        sap=HttpSapClient(client=sap),
        solver=InProcessSolver(),
        store=SqliteCaseStore(":memory:", clock),
        audit=LocalAuditWriter(tmp_path / "audit", clock),
        clock=clock,
    )


def demo_case(rt, llm):
    signals = build_signals(
        (DEMO / "whatsapp_driver.txt").read_text(encoding="utf-8"), DEMO / "forwarder_notice.pdf"
    )
    agent = make_agent(rt, llm)
    c = agent.run(agent.start_case(signals, day0="2026-10-28T17:00:00Z").case_id)
    assert c.status == "AWAITING_APPROVAL", c.escalation_reason
    assert c.summary["chosen_cost"] == 11_400_000 and c.summary["saving_vs_baseline"] == 19_600_000
    approval = next(a for a in c.actions if a.get("approval_id"))["approval_id"]
    agent.decide(c.case_id, approval, True, by="planner")
    assert agent.verify(c.case_id).status == "RESOLVED"
    return rt.store.list_events(c.case_id), rt.audit.read(c.case_id)


@pytest.mark.parametrize("orchestration", ["single", "multi"])
def test_demo_case_on_sap_genai(sap, tmp_path, orchestration):
    from agent.providers.scripts import golden_scripts

    rt = build(sap, tmp_path, ORCHESTRATION=orchestration)
    events, audit = demo_case(rt, provider(AiCoreSim(model=FakeProvider(golden_scripts()))))
    llm = [e for e in events if e.status == "llm"]
    assert llm and all(e.data["model"] == f"sap:{MODEL}" for e in llm)
    assert not any(e.status == "fallback" for e in events)
    assert all(e.payload["model"] == f"sap:{MODEL}" for e in audit if e.kind == "llm_call")


def test_demo_case_falls_back_from_bedrock_at_its_start(sap, tmp_path):
    from agent.providers.scripts import golden_scripts

    rt = build(sap, tmp_path, ORCHESTRATION="multi", DELAY_MODEL="fake", PII_MASKING="local")
    blocked = Raising([LLMError("Bedrock ValidationException: Operation not allowed", "account")])
    fb = FallbackProvider(blocked, provider(AiCoreSim(model=FakeProvider(golden_scripts()))))
    events, audit = demo_case(rt, fb)
    notes = [e for e in events if e.status == "fallback"]
    assert len(notes) == 1 and notes[0].title == "Model: Claude via SAP AI Core"
    assert notes[0].stage == "PERCEIVE" and "Operation not allowed" in notes[0].detail
    assert blocked.calls == 1  # Bedrock was tried once, at the start, then never again
    assert sum(e.kind == "llm_fallback" for e in audit) == 1


def test_missing_aws_profile_or_model_moves_the_case_to_sap(monkeypatch):
    """The laptop case: no `siaga` profile yet, no BEDROCK_MODEL_ID; nothing crashes."""
    monkeypatch.setenv("AWS_PROFILE", "no-such-profile-siaga-test")
    no_profile = BedrockProvider("apac.some-model", "ap-southeast-1")  # client built lazily
    with pytest.raises(LLMError) as e:
        no_profile.converse(REQ)
    assert e.value.kind == "account" and "no-such-profile" in str(e.value)
    for primary in (no_profile, BedrockProvider("", "ap-southeast-1")):
        fb = FallbackProvider(primary, provider(AiCoreSim([OK])))
        r = fb.converse(REQ.model_copy(update={"case_id": "x"}))
        assert r.model == f"sap:{MODEL}" and r.fallback_reason


def test_template_placeholders_count_as_unset():
    s = Settings(_env_file=None, AICORE_AUTH_URL="<set-me>", BEDROCK_MODEL_ID="<set-me>",
                 CASE_API_URL="<set-me>")  # fmt: skip
    assert s.aicore_auth_url is None and s.bedrock_model_id is None
    assert s.case_api_url == "http://127.0.0.1:8000"  # the default, not the placeholder
