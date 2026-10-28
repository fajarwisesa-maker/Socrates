"""LLM providers: record/replay, fake, simulated throttling, AWS values from .env.

The SAP AI Core provider (the live one) is tested in test_sap_genai.py."""

import pytest

from agent.providers.base import LLMError, LLMRequest, user_text
from agent.providers.fake import FakeProvider, say
from agent.providers.replay import RecordingProvider, ReplayProvider

REQ = LLMRequest(
    purpose="perceive",
    system="sys",
    messages=[user_text("hi")],
    tools=[
        {"toolSpec": {"name": "t", "description": "d", "inputSchema": {"json": {"type": "object"}}}}
    ],
)


def test_record_then_replay(tmp_path):
    path = tmp_path / "golden.jsonl"
    rec = RecordingProvider(FakeProvider({"perceive": lambda r, n: say(f"answer {n}")}), path)
    rec.converse(REQ)
    rec.converse(REQ)
    replay = ReplayProvider(path)
    assert replay.converse(REQ).text() == "answer 0"
    second = replay.converse(REQ)
    assert second.text() == "answer 1" and second.model.startswith("replay:")
    with pytest.raises(LLMError, match="no recorded"):
        replay.converse(REQ)


def test_simulated_throttle_reports_retries_then_succeeds():
    from agent.providers.throttle import SimulatedThrottleProvider

    waits, seen = [], []
    inner = FakeProvider({"perceive": lambda r, n: say("ok")})
    p = SimulatedThrottleProvider(inner, "2", sleep=waits.append)
    req = REQ.model_copy(update={"case_id": "c1"})
    assert p.converse(req, on_retry=lambda *a: seen.append(a)).text() == "ok"
    assert seen == [(2, 6, 1.5, "throttled"), (3, 6, 1.5, "throttled")] and waits == [1.5, 1.5]
    p.converse(req, on_retry=lambda *a: seen.append(a))  # once per case only
    assert len(seen) == 2


def test_simulated_throttle_exhaust_raises_llm_error():
    from agent.providers.throttle import SimulatedThrottleProvider

    p = SimulatedThrottleProvider(
        FakeProvider({"perceive": lambda r, n: say("ok")}), "exhaust", sleep=lambda s: None
    )
    with pytest.raises(LLMError, match="after 6 attempts"):
        p.converse(REQ.model_copy(update={"case_id": "c1"}))


def test_aws_values_in_dotenv_reach_boto3_but_real_env_wins(tmp_path, monkeypatch):
    from siaga_common.settings import export_aws_env

    env = tmp_path / ".env"
    env.write_text(
        "LLM_PROVIDER=sap_genai\nAWS_REGION=eu-central-1\nAWS_PROFILE=from-dotenv\n",
        encoding="utf-8",
    )
    monkeypatch.delenv("AWS_REGION", raising=False)
    monkeypatch.setenv("AWS_PROFILE", "from-shell")
    assert export_aws_env(env) == ["AWS_REGION"]
    import os

    assert os.environ["AWS_REGION"] == "eu-central-1"
    assert os.environ["AWS_PROFILE"] == "from-shell"  # the real environment wins
    monkeypatch.delenv("AWS_REGION")
