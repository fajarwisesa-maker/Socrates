"""Central configuration, read from environment variables (and `.env` if present).

Every AWS dependency is selected by a backend switch here so that Phases 1-6 run
fully locally and Phase 7 only swaps implementations, never agent logic.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    # --- LLM ---
    llm_provider: Literal["bedrock", "fake", "replay"] = Field("bedrock", alias="LLM_PROVIDER")
    # Deliberately no default: the model must be chosen explicitly (see CLAUDE.md).
    bedrock_model_id: str | None = Field(None, alias="BEDROCK_MODEL_ID")
    aws_region: str = Field("ap-southeast-1", alias="AWS_REGION")
    replay: bool = Field(False, alias="REPLAY")
    # Brief: temperature 0. Current Claude models reject non-default sampling parameters;
    # the Bedrock provider then drops it automatically. "off" never sends it.
    llm_temperature: str = Field("0", alias="LLM_TEMPERATURE")
    replay_path: Path = Field(REPO_ROOT / "data" / "golden" / "llm.jsonl", alias="REPLAY_PATH")
    # 1.0 = replay at the recorded model latency (looks live on stage), 0 = instant.
    replay_speed: float = Field(1.0, alias="REPLAY_SPEED")
    # demo/test aid: "N" visible retries on each case's first model call, or "exhaust"
    llm_simulate_throttle: str = Field("", alias="LLM_SIMULATE_THROTTLE")
    llm_record_path: Path | None = Field(None, alias="LLM_RECORD_PATH")

    # --- Backends (local now, AWS in Phase 7) ---
    case_store: Literal["sqlite", "dynamodb"] = Field("sqlite", alias="CASE_STORE")
    audit_backend: Literal["local", "s3"] = Field("local", alias="AUDIT_BACKEND")
    kb_backend: Literal["local", "bedrock"] = Field("local", alias="KB_BACKEND")
    policy_backend: Literal["local", "agentcore"] = Field("local", alias="POLICY_BACKEND")
    solver_backend: Literal["inprocess", "http", "lambda"] = Field(
        "inprocess", alias="SOLVER_BACKEND"
    )

    # --- Local service endpoints and paths ---
    sap_mock_url: str = Field("http://127.0.0.1:8001", alias="SAP_MOCK_URL")
    # Case API only: run the mock S/4HANA in-process instead of calling SAP_MOCK_URL.
    embedded_sap: bool = Field(False, alias="EMBEDDED_SAP")
    solver_url: str = Field("http://127.0.0.1:8002", alias="SOLVER_URL")
    case_api_url: str = Field("http://127.0.0.1:8000", alias="CASE_API_URL")
    sqlite_path: Path = Field(REPO_ROOT / "var" / "siaga.db", alias="SQLITE_PATH")
    sap_db_path: Path = Field(REPO_ROOT / "var" / "sap_mock.db", alias="SAP_DB_PATH")
    audit_dir: Path = Field(REPO_ROOT / "var" / "audit", alias="AUDIT_DIR")

    # --- v2 flags (docs/v2-flags.md); every default = v1 behaviour ---
    # single: the v1 state machine; multi: specialist Strands agents under the same
    # deterministic orchestrator
    orchestration: Literal["single", "multi"] = Field("single", alias="ORCHESTRATION")
    # signal: Perceive's delay range; rpt: SAP RPT-1.6 on AI Core (combined in code with the
    # signal range); fake: an offline, labelled stand-in for tests and runs without SAP
    delay_model: Literal["signal", "rpt", "fake"] = Field("signal", alias="DELAY_MODEL")
    rpt_timeout_seconds: float = Field(5.0, alias="RPT_TIMEOUT_SECONDS")
    history_path: Path = Field(
        REPO_ROOT / "data" / "history" / "disruptions.csv", alias="DELAY_HISTORY_PATH"
    )

    # --- SAP AI Core (service key; set in the environment, never committed or printed) ---
    aicore_auth_url: str | None = Field(None, alias="AICORE_AUTH_URL")
    aicore_client_id: str | None = Field(None, alias="AICORE_CLIENT_ID")
    aicore_client_secret: SecretStr | None = Field(None, alias="AICORE_CLIENT_SECRET")
    aicore_api_url: str | None = Field(None, alias="AICORE_API_URL")
    aicore_resource_group: str = Field("default", alias="AICORE_RESOURCE_GROUP")
    aicore_rpt_deployment_id: str | None = Field(None, alias="AICORE_RPT_DEPLOYMENT_ID")

    # --- Agent loop limits (enforced in code, not by the model) ---
    max_tool_calls: int = Field(20, alias="MAX_TOOL_CALLS")
    max_replans: int = Field(2, alias="MAX_REPLANS")
    verify_delay_seconds: int = Field(60, alias="VERIFY_DELAY_SECONDS")

    @model_validator(mode="after")
    def _multi_golden(self) -> Settings:
        # The multi-agent run has its own recording (other LLM purposes); the v1 one stays
        # the v1 fallback. An explicit REPLAY_PATH always wins.
        if self.orchestration == "multi" and "replay_path" not in self.model_fields_set:
            self.replay_path = REPO_ROOT / "data" / "golden" / "multi" / "llm.jsonl"
        return self

    def require_model_id(self) -> str:
        if not self.bedrock_model_id:
            raise RuntimeError(
                "BEDROCK_MODEL_ID is not set. Pick a model with `make aws-check` "
                "and put it in .env (no default is hardcoded on purpose)."
            )
        return self.bedrock_model_id


def export_aws_env(env_file: Path | None = None) -> list[str]:
    """Copy AWS_* values from `.env` into os.environ for boto3.

    pydantic-settings reads `.env` only for the fields above; boto3 reads credentials
    (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN, AWS_PROFILE, or a
    Bedrock API key in AWS_BEARER_TOKEN_BEDROCK) from the process environment. Variables
    already set in the real environment win. Returns the names exported (never values).
    """
    import os

    from dotenv import dotenv_values

    path = env_file or REPO_ROOT / ".env"
    if not path.exists():
        return []
    exported = []
    for key, value in dotenv_values(path, encoding="utf-8").items():
        if key.startswith("AWS_") and value and key not in os.environ:
            os.environ[key] = value
            exported.append(key)
    return exported


@lru_cache
def get_settings() -> Settings:
    return Settings()
