"""Central configuration, read from environment variables (and `.env` if present).

Every AWS dependency is selected by a backend switch here so that Phases 1-6 run
fully locally and Phase 7 only swaps implementations, never agent logic.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parent.parent
PLACEHOLDER = "<set-me>"  # unfilled value in the .env.<mode> templates


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    # --- LLM ---
    # sap_genai: Claude on SAP AI Core (Generative AI Hub); fake: the scripted model for
    # tests and offline demos; replay: the golden recording
    llm_provider: Literal["sap_genai", "fake", "replay"] = Field("sap_genai", alias="LLM_PROVIDER")
    # the Generative AI Hub model name; its deployment is found in AICORE_RESOURCE_GROUP
    # (scenario foundation-models) unless SAP_GENAI_DEPLOYMENT_ID names it
    sap_genai_model: str = Field("anthropic--claude-4.6-sonnet", alias="SAP_GENAI_MODEL")
    sap_genai_deployment_id: str | None = Field(None, alias="SAP_GENAI_DEPLOYMENT_ID")
    aws_region: str = Field("ap-southeast-1", alias="AWS_REGION")
    replay: bool = Field(False, alias="REPLAY")
    # Brief: temperature 0. If the model rejects a sampling parameter, the provider drops it
    # once and carries on. "off" never sends it.
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
    kb_backend: Literal["local"] = Field("local", alias="KB_BACKEND")
    policy_backend: Literal["local"] = Field("local", alias="POLICY_BACKEND")
    solver_backend: Literal["inprocess", "http", "lambda"] = Field(
        "inprocess", alias="SOLVER_BACKEND"
    )
    # AUDIT_BACKEND=s3: each audit entry is also stored as its own object in this bucket
    # (created with Object Lock by `make aws-setup`; default retention, governance mode)
    audit_s3_bucket: str | None = Field(None, alias="AUDIT_S3_BUCKET")
    audit_s3_prefix: str = Field("audit/", alias="AUDIT_S3_PREFIX")
    audit_retention_days: int = Field(1, ge=1, alias="AUDIT_RETENTION_DAYS")
    # SOLVER_BACKEND=lambda: the function `make aws-setup` deploys (services/solver)
    solver_lambda_name: str = Field("siaga-solver", alias="SOLVER_LAMBDA_NAME")
    # on a Lambda error or timeout, solve in process (each tool call says where it ran)
    solver_lambda_fallback: bool = Field(True, alias="SOLVER_LAMBDA_FALLBACK")

    # --- Local service endpoints and paths ---
    sap_mock_url: str = Field("http://127.0.0.1:8001", alias="SAP_MOCK_URL")
    # v2 step 1: the same mock S/4HANA on SAP BTP Cloud Foundry (the org is shared, so it
    # requires X-API-Key; the mock checks it whenever SAP_MOCK_API_KEY is set where it runs)
    sap_mock_on_btp: bool = Field(False, alias="SAP_MOCK_ON_BTP")
    sap_mock_btp_url: str | None = Field(None, alias="SAP_MOCK_BTP_URL")
    sap_mock_api_key: SecretStr | None = Field(None, alias="SAP_MOCK_API_KEY")
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
    # step 5: mask phone numbers, e-mails and personal names in signals before any model
    # call (local = deterministic masker)
    pii_masking: Literal["off", "local"] = Field("off", alias="PII_MASKING")
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

    # WhatsApp inbound (option A, 28 Oct): a message to the team's WhatsApp test number opens
    # a case. A separate webhook app (api/whatsapp.py) on WHATSAPP_PORT is the only thing the
    # public tunnel exposes; it forwards allowed, signed messages to POST /cases.
    whatsapp_inbound: bool = Field(False, alias="WHATSAPP_INBOUND")
    whatsapp_verify_token: SecretStr | None = Field(None, alias="WHATSAPP_VERIFY_TOKEN")
    whatsapp_app_secret: SecretStr | None = Field(None, alias="WHATSAPP_APP_SECRET")
    # comma-separated: phone numbers in international format (wa_id) and/or user IDs
    whatsapp_allowed_senders: str = Field("", alias="WHATSAPP_ALLOWED_SENDERS")
    whatsapp_port: int = Field(8010, alias="WHATSAPP_PORT")
    # older messages are ignored (Meta retries undelivered webhooks for a long time)
    whatsapp_max_age_seconds: int = Field(600, alias="WHATSAPP_MAX_AGE_SECONDS")
    # option B: when a case opened from WhatsApp ends (resolved, escalated, re-opened), the
    # Case API replies to the sender with the outcome, through the Cloud API (Graph API).
    whatsapp_notify: bool = Field(False, alias="WHATSAPP_NOTIFY")
    whatsapp_access_token: SecretStr | None = Field(None, alias="WHATSAPP_ACCESS_TOKEN")
    whatsapp_phone_number_id: str | None = Field(None, alias="WHATSAPP_PHONE_NUMBER_ID")
    whatsapp_graph_version: str = Field("26.0", alias="WHATSAPP_GRAPH_VERSION")
    whatsapp_graph_url: str = Field("https://graph.facebook.com", alias="WHATSAPP_GRAPH_URL")
    # Which WhatsApp provider the webhook and the replies use: Meta's Cloud API (a Meta app and
    # test number) or Twilio (its WhatsApp sandbox; no Meta app). docs/whatsapp-inbound.md
    whatsapp_provider: Literal["meta", "twilio"] = Field("meta", alias="WHATSAPP_PROVIDER")
    twilio_account_sid: str | None = Field(None, alias="TWILIO_ACCOUNT_SID")
    twilio_auth_token: SecretStr | None = Field(None, alias="TWILIO_AUTH_TOKEN")
    # the sandbox's shared number, or your own Twilio WhatsApp sender
    twilio_whatsapp_from: str = Field("whatsapp:+14155238886", alias="TWILIO_WHATSAPP_FROM")
    # the exact URL set in the Twilio console, when the tunnel does not pass the public host
    twilio_webhook_url: str | None = Field(None, alias="TWILIO_WEBHOOK_URL")
    twilio_api_url: str = Field("https://api.twilio.com", alias="TWILIO_API_URL")

    # step 4 (not built): Tier 3 approvals from the SAP Joule capability
    joule_approvals: bool = Field(False, alias="JOULE_APPROVALS")

    # --- Where configuration comes from (docs/connections.md, siaga_common/sources.py) ---
    # Informational: which laptop env file is active (make use-aws|use-replay|use-v1).
    siaga_mode: Literal["local", "aws", "replay", "v1"] | None = Field(None, alias="SIAGA_MODE")
    # env: flags from the environment / .env. ssm: SSM Parameter Store under
    # /siaga/flags/, read again at the start of every case (no redeploy to switch).
    flags_source: Literal["env", "ssm"] = Field("env", alias="FLAGS_SOURCE")
    # env: SAP secrets from the environment. aws: the Secrets Manager secret
    # SAP_SECRET_ID, read once at startup with the process's IAM role.
    secrets_source: Literal["env", "aws"] = Field("env", alias="SECRETS_SOURCE")
    sap_secret_id: str = Field("siaga/sap", alias="SAP_SECRET_ID")
    # The Case API requires X-API-Key when this is set (the deployed API always has it).
    case_api_key: SecretStr | None = Field(None, alias="CASE_API_KEY")

    # --- Agent loop limits (enforced in code, not by the model) ---
    max_tool_calls: int = Field(20, alias="MAX_TOOL_CALLS")
    max_replans: int = Field(2, alias="MAX_REPLANS")
    verify_delay_seconds: int = Field(60, alias="VERIFY_DELAY_SECONDS")

    @model_validator(mode="before")
    @classmethod
    def _placeholders_are_unset(cls, data: Any) -> Any:
        # `<set-me>` in a .env.<mode> template means "not filled in yet": treat it as unset,
        # so checks say which variable is missing instead of failing on a fake URL
        if isinstance(data, dict):
            return {k: v for k, v in data.items() if v != PLACEHOLDER}
        return data

    @model_validator(mode="after")
    def _multi_golden(self) -> Settings:
        # The multi-agent run has its own recording (other LLM purposes); the v1 one stays
        # the v1 fallback. An explicit REPLAY_PATH always wins.
        if self.orchestration == "multi" and "replay_path" not in self.model_fields_set:
            self.replay_path = REPO_ROOT / "data" / "golden" / "multi" / "llm.jsonl"
            # derived, not given: keep it re-derivable when flags are overlaid (sources.py)
            self.__pydantic_fields_set__.discard("replay_path")
        return self

    def sap_endpoint(self) -> tuple[str, dict[str, str]]:
        """(base URL, headers) of the mock S/4HANA: localhost, or BTP when SAP_MOCK_ON_BTP=1.
        The only place that switches; nothing else changes with the flag."""
        headers = (
            {"X-API-Key": self.sap_mock_api_key.get_secret_value()} if self.sap_mock_api_key else {}
        )
        if not self.sap_mock_on_btp:
            return self.sap_mock_url, headers
        if not self.sap_mock_btp_url or not headers:
            raise RuntimeError(
                "SAP_MOCK_ON_BTP=1 needs SAP_MOCK_BTP_URL and SAP_MOCK_API_KEY (docs/v2-flags.md)"
            )
        return self.sap_mock_btp_url.rstrip("/"), headers

    def case_api_headers(self) -> dict[str, str]:
        """Headers for calling the Case API (the key, when one is configured)."""
        return {"X-API-Key": self.case_api_key.get_secret_value()} if self.case_api_key else {}


def export_aws_env(env_file: Path | None = None) -> list[str]:
    """Copy AWS_* values from `.env` into os.environ for boto3.

    pydantic-settings reads `.env` only for the fields above; boto3 (S3 audit trail, Lambda
    solver, SSM / Secrets Manager) reads credentials (AWS_PROFILE, or AWS_ACCESS_KEY_ID /
    AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN) from the process environment. Variables
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
