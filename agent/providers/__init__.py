"""LLM providers: bedrock | fake | replay, chosen by settings (REPLAY=1 forces replay)."""

from __future__ import annotations

from agent.providers.base import LLMProvider
from siaga_common.settings import Settings


def make_provider(settings: Settings) -> LLMProvider:
    if settings.replay or settings.llm_provider == "replay":
        from agent.providers.replay import ReplayProvider

        return ReplayProvider(settings.replay_path)
    if settings.llm_provider == "fake":
        from agent.providers.fake import FakeProvider
        from agent.providers.scripts import golden_scripts

        provider: LLMProvider = FakeProvider(golden_scripts())
    else:
        from agent.providers.bedrock import BedrockProvider

        temp = (
            None if settings.llm_temperature.lower() == "off" else float(settings.llm_temperature)
        )
        provider = BedrockProvider(settings.require_model_id(), settings.aws_region, temp)
    if settings.llm_record_path:
        from agent.providers.replay import RecordingProvider

        provider = RecordingProvider(provider, settings.llm_record_path)
    return provider
