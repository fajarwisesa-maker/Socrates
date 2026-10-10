"""LLM providers: Bedrock request shape (stubbed client), record/replay, fake."""

import pytest
from botocore.exceptions import ClientError

from agent.providers.base import LLMError, LLMRequest, user_text
from agent.providers.bedrock import BedrockProvider
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
OK = {
    "output": {"message": {"role": "assistant", "content": [{"text": "ok"}]}},
    "stopReason": "end_turn",
    "usage": {"inputTokens": 3, "outputTokens": 1},
    "metrics": {"latencyMs": 12},
}


class StubClient:
    def __init__(self, responses):
        self.responses, self.calls = list(responses), []

    def converse(self, **kwargs):
        self.calls.append(kwargs)
        r = self.responses.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


def client_error(code, msg):
    return ClientError({"Error": {"Code": code, "Message": msg}}, "Converse")


def test_bedrock_request_shape():
    stub = StubClient([OK])
    resp = BedrockProvider("model-x", "ap-southeast-1", 0.0, client=stub).converse(REQ)
    call = stub.calls[0]
    assert call["modelId"] == "model-x"
    assert call["system"] == [{"text": "sys"}]
    assert call["inferenceConfig"] == {"maxTokens": 4096, "temperature": 0.0}
    assert call["toolConfig"]["toolChoice"] == {"auto": {}}  # never forced
    assert resp.text() == "ok" and resp.latency_ms == 12


def test_bedrock_drops_rejected_temperature_once():
    stub = StubClient(
        [client_error("ValidationException", "temperature is not supported for this model"), OK, OK]
    )
    p = BedrockProvider("model-x", "ap-southeast-1", 0.0, client=stub)
    p.converse(REQ)
    p.converse(REQ)
    assert "temperature" in stub.calls[0]["inferenceConfig"]
    assert "temperature" not in stub.calls[1]["inferenceConfig"]
    assert "temperature" not in stub.calls[2]["inferenceConfig"]


def test_bedrock_errors_become_llm_error():
    stub = StubClient([client_error("AccessDeniedException", "no model access")])
    with pytest.raises(LLMError, match="AccessDeniedException"):
        BedrockProvider("m", "ap-southeast-1", client=stub).converse(REQ)
    assert len(stub.calls) == 1  # not retried


def test_bedrock_retries_throttling_visibly():
    stub = StubClient([client_error("ThrottlingException", "slow down")] * 2 + [OK])
    waits, seen = [], []
    p = BedrockProvider("m", "ap-southeast-1", client=stub, sleep=waits.append)
    resp = p.converse(REQ, on_retry=lambda *a: seen.append(a))
    assert resp.text() == "ok" and len(stub.calls) == 3
    assert waits == [2.0, 4.0]
    assert seen == [(2, 6, 2.0, "throttled"), (3, 6, 4.0, "throttled")]


def test_bedrock_gives_up_after_max_attempts():
    stub = StubClient([client_error("ThrottlingException", "slow down")] * 6)
    p = BedrockProvider("m", "ap-southeast-1", client=stub, sleep=lambda s: None)
    with pytest.raises(LLMError, match="after 6 attempts"):
        p.converse(REQ)
    assert len(stub.calls) == 6


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
