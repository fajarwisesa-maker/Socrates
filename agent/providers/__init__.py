"""LLM providers: bedrock | fake | replay, chosen by settings (REPLAY=1 forces replay)."""

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
    else:
        from agent.providers.bedrock import BedrockProvider
        from siaga_common.settings import export_aws_env

        export_aws_env()  # credentials / Bedrock API key from .env reach boto3

        temp = (
            None if settings.llm_temperature.lower() == "off" else float(settings.llm_temperature)
        )
        provider = BedrockProvider(settings.require_model_id(), settings.aws_region, temp)
    if settings.llm_record_path:
        from agent.providers.replay import RecordingProvider

        provider = RecordingProvider(provider, settings.llm_record_path)
    return _throttled(provider, settings)


def _throttled(provider: LLMProvider, settings: Settings) -> LLMProvider:
    if not settings.llm_simulate_throttle:
        return provider
    from agent.providers.throttle import SimulatedThrottleProvider

    return SimulatedThrottleProvider(provider, settings.llm_simulate_throttle)
