"""Configuration that does not come from the environment (map: docs/connections.md).

- **Secrets** (`SECRETS_SOURCE=aws`): the Secrets Manager secret `siaga/sap`, a JSON object
  with the keys in SECRET_KEYS. Read once per process with its IAM role, then cached.
- **Flags** (`FLAGS_SOURCE=ssm`): one SSM String parameter per flag under `/siaga/flags/`.
  The Case API reads them again at the start of every case, so `make flags-v2` /
  `make flags-v1` take effect on the next case without a redeploy. Backend settings are
  stored there too but only apply when a process starts.

Neither source ever prints or logs a value; errors name keys, never contents.
"""

from __future__ import annotations

import json
import logging
import threading
from collections.abc import Mapping
from typing import Any

from siaga_common.settings import Settings

log = logging.getLogger(__name__)

# --- secrets ---------------------------------------------------------------------------
# The BTP copy of the mock S/4HANA is SAP_MOCK_BTP_URL in code (SAP_MOCK_URL stays the
# local / AWS-hosted mock), so that is the URL key stored in the secret.
SECRET_KEYS = (
    "AICORE_AUTH_URL",
    "AICORE_CLIENT_ID",
    "AICORE_CLIENT_SECRET",
    "AICORE_API_URL",
    "AICORE_RESOURCE_GROUP",
    "AICORE_RPT_DEPLOYMENT_ID",
    "SAP_MOCK_BTP_URL",
    "SAP_MOCK_API_KEY",
    "CASE_API_KEY",
)
OPTIONAL_SECRET_KEYS = {"AICORE_RESOURCE_GROUP"}  # defaults to "default"

_secret_cache: dict[str, dict[str, str]] = {}
_secret_lock = threading.Lock()


class ConfigSourceError(RuntimeError):
    pass


def _client(service: str, region: str, client: Any = None) -> Any:
    if client is not None:
        return client
    import boto3

    return boto3.client(service, region_name=region)


def read_secret(s: Settings, client: Any = None) -> dict[str, str]:
    """The secret's key/value pairs (cached per process). Raises ConfigSourceError."""
    with _secret_lock:
        if s.sap_secret_id in _secret_cache:
            return _secret_cache[s.sap_secret_id]
        try:
            raw = _client("secretsmanager", s.aws_region, client).get_secret_value(
                SecretId=s.sap_secret_id
            )["SecretString"]
            values = json.loads(raw)
        except json.JSONDecodeError as e:
            raise ConfigSourceError(f"secret {s.sap_secret_id} is not a JSON object") from e
        except Exception as e:  # noqa: BLE001 - botocore errors carry no secret values
            raise ConfigSourceError(
                f"cannot read secret {s.sap_secret_id}: {type(e).__name__}"
            ) from e
        if not isinstance(values, dict):
            raise ConfigSourceError(f"secret {s.sap_secret_id} is not a JSON object")
        unknown = sorted(set(values) - set(SECRET_KEYS))
        if unknown:
            log.warning("secret %s has unknown keys (ignored): %s", s.sap_secret_id, unknown)
        _secret_cache[s.sap_secret_id] = {
            k: str(v) for k, v in values.items() if k in SECRET_KEYS and v not in (None, "")
        }
        return _secret_cache[s.sap_secret_id]


def clear_secret_cache() -> None:
    with _secret_lock:
        _secret_cache.clear()


def missing_secret_keys(values: Mapping[str, str]) -> list[str]:
    return [k for k in SECRET_KEYS if k not in OPTIONAL_SECRET_KEYS and not values.get(k)]


def with_secrets(s: Settings, client: Any = None) -> Settings:
    """Settings with the secret's values on top (SECRETS_SOURCE=aws); unchanged otherwise."""
    if s.secrets_source != "aws":
        return s
    return overlay(s, read_secret(s, client))


# --- flags -----------------------------------------------------------------------------
FLAG_PREFIX = "/siaga/flags/"
# Read at the start of every case.
CASE_FLAGS = (
    "ORCHESTRATION",
    "DELAY_MODEL",
    "SAP_MOCK_ON_BTP",
    "PII_MASKING",
    "JOULE_APPROVALS",
    "LLM_PROVIDER",
    "REPLAY",
)
# Stored with the flags, applied when a process starts (they pick the store, audit, ...).
BACKEND_FLAGS = ("CASE_STORE", "AUDIT_BACKEND", "KB_BACKEND", "POLICY_BACKEND", "SOLVER_BACKEND")
ALL_FLAGS = CASE_FLAGS + BACKEND_FLAGS

AWS_BACKENDS = {
    "CASE_STORE": "dynamodb",
    "AUDIT_BACKEND": "s3",
    "KB_BACKEND": "local",
    "POLICY_BACKEND": "local",
    "SOLVER_BACKEND": "lambda",
}
# Demo Day (make flags-v2)
FLAGS_V2 = {
    "ORCHESTRATION": "multi",
    "DELAY_MODEL": "rpt",
    "SAP_MOCK_ON_BTP": "1",
    "PII_MASKING": "local",
    "JOULE_APPROVALS": "0",
    "LLM_PROVIDER": "sap_genai",
    "REPLAY": "0",
    **AWS_BACKENDS,
}
# Every v2 flag off, AWS backends kept (make flags-v1)
FLAGS_V1 = {
    "ORCHESTRATION": "single",
    "DELAY_MODEL": "signal",
    "SAP_MOCK_ON_BTP": "0",
    "PII_MASKING": "off",
    "JOULE_APPROVALS": "0",
    "LLM_PROVIDER": "sap_genai",
    "REPLAY": "0",
    **AWS_BACKENDS,
}
PRESETS = {"v2": FLAGS_V2, "v1": FLAGS_V1}


def overlay(s: Settings, values: Mapping[str, Any]) -> Settings:
    """A validated copy of `s` with `values` (keyed by env-var name) on top.

    Every field is carried over, so nothing is read again from the environment or `.env`;
    only a derived REPLAY_PATH (the multi-agent recording) is derived again.
    """
    if not values:
        return s
    data = s.model_dump(by_alias=True)
    if "replay_path" not in s.model_fields_set:
        data.pop("REPLAY_PATH")
    data.update(values)
    return type(s).model_validate(data)


def _flag_str(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return "1" if v else "0"
    return str(v)


def snapshot(s: Settings) -> dict[str, str]:
    """The flag values a process / case runs with, as stored in SSM (for the audit trail)."""
    by_alias = s.model_dump(by_alias=True)
    by_alias["JOULE_APPROVALS"] = s.joule_approvals
    return {k: _flag_str(by_alias[k]) for k in ALL_FLAGS}


class SsmFlags:
    """Reads /siaga/flags/* (every call goes to SSM; errors raise ConfigSourceError)."""

    def __init__(self, region: str, prefix: str = FLAG_PREFIX, client: Any = None):
        self.region, self.prefix, self._c = region, prefix, client

    @property
    def client(self) -> Any:
        if self._c is None:
            self._c = _client("ssm", self.region)
        return self._c

    def read(self) -> dict[str, str]:
        out: dict[str, str] = {}
        try:
            token = None
            while True:
                kw: dict[str, Any] = {"Path": self.prefix, "Recursive": False}
                if token:
                    kw["NextToken"] = token
                page = self.client.get_parameters_by_path(**kw)
                for p in page.get("Parameters", []):
                    name = p["Name"].removeprefix(self.prefix)
                    if name in ALL_FLAGS:
                        out[name] = p["Value"]
                token = page.get("NextToken")
                if not token:
                    return out
        except Exception as e:  # noqa: BLE001
            raise ConfigSourceError(
                f"cannot read SSM {self.prefix}*: {type(e).__name__}: {e}"
            ) from e

    def write(self, values: Mapping[str, str]) -> None:
        for name, value in values.items():
            if name not in ALL_FLAGS:
                raise ValueError(f"unknown flag {name}")
            self.client.put_parameter(
                Name=self.prefix + name, Value=value, Type="String", Overwrite=True
            )


def preset(name: str) -> dict[str, str]:
    return dict(PRESETS[name])


def diff(
    actual: Mapping[str, str], expected: Mapping[str, str]
) -> dict[str, tuple[str | None, str]]:
    """{flag: (actual, expected)} for every flag that does not match."""
    return {k: (actual.get(k), v) for k, v in expected.items() if actual.get(k) != v}
