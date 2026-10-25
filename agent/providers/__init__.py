"""LLM providers: bedrock | sap_genai | fake | replay, chosen by settings (REPLAY=1 forces
replay); LLM_FALLBACK=sap_genai wraps Bedrock with a per-case fallback to SAP AI Core."""

from __future__ import annotations

from agent.providers.base import LLMProvider
from siaga_common.settings import Settings


def make_provider(settings: Settings) -> LLMProvider:
    if settings.replay or settings.llm_provider == "replay":
        from agent.providers.replay import ReplayProvider

        return _throttled(
            ReplayProvider(settings.replay_path, speed=settings.replay_speed), settings
        )
    if settings.llm_provider == "fake":
        from agent.providers.fake import FakeProvider
        from agent.providers.scripts import golden_scripts

        provider: LLMProvider = FakeProvider(golden_scripts())
    elif settings.llm_provider == "sap_genai":
        provider = make_sap_genai(settings)
    else:
        from agent.providers.bedrock import BedrockProvider
        from siaga_common.settings import export_aws_env

        export_aws_env()  # credentials / Bedrock API key from .env reach boto3
        fallback = settings.llm_fallback == "sap_genai"
        provider = BedrockProvider(
            # with the fallback, a missing model ID moves each case to SAP (with the note)
            settings.bedrock_model_id or "" if fallback else settings.require_model_id(),
            settings.aws_region,
            _temperature(settings),
            # with a fallback, one retry on throttling, then the case moves to SAP
            max_attempts=2 if fallback else 6,
        )
        if fallback:
            from agent.providers.fallback import FallbackProvider

            provider = FallbackProvider(provider, make_sap_genai(settings))
    if settings.llm_record_path:
        from agent.providers.replay import RecordingProvider

        provider = RecordingProvider(provider, settings.llm_record_path)
    return _throttled(provider, settings)


def _throttled(provider: LLMProvider, settings: Settings) -> LLMProvider:
    if not settings.llm_simulate_throttle:
        return provider
    from agent.providers.throttle import SimulatedThrottleProvider

    return SimulatedThrottleProvider(provider, settings.llm_simulate_throttle)


def _temperature(settings: Settings) -> float | None:
    return None if settings.llm_temperature.lower() == "off" else float(settings.llm_temperature)


def make_sap_genai(settings: Settings) -> LLMProvider:
    from agent.aicore import aicore_from_settings
    from agent.providers.sap_genai import SapGenAIProvider

    return SapGenAIProvider(
        aicore_from_settings(settings, "LLM_PROVIDER=sap_genai / LLM_FALLBACK=sap_genai"),
        settings.sap_genai_model,
        settings.sap_genai_deployment_id,
        _temperature(settings),
    )


PING_TOOL = {
    "toolSpec": {
        "name": "report_status",
        "description": "Report that the connection works.",
        "inputSchema": {
            "json": {
                "type": "object",
                "properties": {"status": {"type": "string"}},
                "required": ["status"],
            }
        },
    }
}


def ping(provider: LLMProvider) -> dict:
    """One tiny tool-use call (preflight, /health/connections). Raises LLMError."""
    import time

    from agent.providers.base import LLMRequest, user_text

    t0 = time.perf_counter()
    resp = provider.converse(
        LLMRequest(
            purpose="ping",
            system="You are a connectivity probe. Always answer by calling the tool.",
            messages=[user_text("Call report_status with status ok.")],
            tools=[PING_TOOL],
            max_tokens=256,
        )
    )
    return {
        "model": resp.model,
        "tool_use": bool(resp.tool_uses()),
        "latency_s": round(time.perf_counter() - t0, 2),
        "fallback_reason": resp.fallback_reason,
    }
