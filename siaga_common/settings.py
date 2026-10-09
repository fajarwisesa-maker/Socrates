"""Central configuration, read from environment variables (and `.env` if present).

Every AWS dependency is selected by a backend switch here so that Phases 1-6 run
fully locally and Phase 7 only swaps implementations, never agent logic.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env", extra="ignore", populate_by_name=True
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

    # --- Agent loop limits (enforced in code, not by the model) ---
    max_tool_calls: int = Field(20, alias="MAX_TOOL_CALLS")
    max_replans: int = Field(2, alias="MAX_REPLANS")
    verify_delay_seconds: int = Field(60, alias="VERIFY_DELAY_SECONDS")

    def require_model_id(self) -> str:
        if not self.bedrock_model_id:
            raise RuntimeError(
                "BEDROCK_MODEL_ID is not set. Pick a model with `make aws-check` "
                "and put it in .env (no default is hardcoded on purpose)."
            )
        return self.bedrock_model_id


@lru_cache
def get_settings() -> Settings:
    return Settings()
