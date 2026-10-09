"""Claude on Amazon Bedrock via the boto3 bedrock-runtime Converse API."""

from __future__ import annotations

import logging
import time

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from agent.providers.base import LLMError, LLMRequest, LLMResponse

log = logging.getLogger(__name__)


class BedrockProvider:
    name = "bedrock"

    def __init__(self, model_id: str, region: str, temperature: float | None = 0.0, client=None):
        self.model_id = model_id
        self.temperature = temperature
        self.client = client or boto3.client(
            "bedrock-runtime",
            region_name=region,
            config=Config(
                retries={"mode": "adaptive", "max_attempts": 6},
                read_timeout=120,
                connect_timeout=10,
            ),
        )

    def _kwargs(self, req: LLMRequest) -> dict:
        inference = {"maxTokens": req.max_tokens}
        if self.temperature is not None:
            inference["temperature"] = self.temperature
        kwargs = {
            "modelId": self.model_id,
            "system": [{"text": req.system}],
            "messages": req.messages,
            "inferenceConfig": inference,
        }
        if req.tools:
            kwargs["toolConfig"] = {"tools": req.tools, "toolChoice": {"auto": {}}}
        return kwargs

    def converse(self, req: LLMRequest) -> LLMResponse:
        t0 = time.perf_counter()
        try:
            resp = self.client.converse(**self._kwargs(req))
        except ClientError as e:
            err = e.response.get("Error", {})
            # Current Claude models reject non-default sampling parameters. The brief asks
            # for temperature 0; if the model refuses it, drop it once and remember.
            if (
                err.get("Code") == "ValidationException"
                and "temperature" in err.get("Message", "").lower()
                and self.temperature is not None
            ):
                log.warning("model %s rejects temperature; continuing without it", self.model_id)
                self.temperature = None
                return self.converse(req)
            raise LLMError(f"Bedrock {err.get('Code')}: {err.get('Message')}") from e
        except BotoCoreError as e:
            raise LLMError(f"Bedrock call failed: {e}") from e
        return LLMResponse(
            message=resp["output"]["message"],
            stop_reason=resp["stopReason"],
            usage=resp.get("usage", {}),
            latency_ms=resp.get("metrics", {}).get("latencyMs", (time.perf_counter() - t0) * 1000),
            model=self.model_id,
        )
