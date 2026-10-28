"""SAP AI Core access shared by the LLM provider (sap_genai): OAuth client credentials and
the foundation-model deployment lookup.

How Generative AI Hub serves Anthropic models was read from SAP's own SDK, not from
memory (the SAP docs hosts are blocked here): `sap-ai-sdk-gen` 7.4.1,
`gen_ai_hub/proxy/native/amazon/clients.py` and `gen_ai_hub/proxy/gen_ai_hub_proxy/client.py`.

- Deployments: `GET {AI_API_URL}/v2/lm/deployments?scenarioId=foundation-models&status=RUNNING`
  with `AI-Resource-Group`; a deployment's model name is
  `details.resources.backend_details.model.name` (else the configuration's `modelName`
  parameter binding). Names look like `anthropic--claude-4.6-sonnet` (the model list in
  `@sap-ai-sdk/orchestration` 2.17.0 has it).
- Calls: the deployment speaks the Converse API. The SDK posts the unsigned Converse body
  to `{deploymentUrl}/converse` with `Authorization: Bearer <token>` and
  `AI-Resource-Group`, and gets a Converse response back.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from typing import Any

import httpx

SCENARIO = "foundation-models"
AICORE_VARS = ("AICORE_AUTH_URL", "AICORE_CLIENT_ID", "AICORE_CLIENT_SECRET", "AICORE_API_URL")


class AiCoreError(Exception):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class AiCore:
    def __init__(
        self,
        auth_url: str,
        client_id: str,
        client_secret: str,
        api_url: str,
        resource_group: str = "default",
        transport: httpx.BaseTransport | None = None,
        clock: Callable[[], float] = time.time,
    ):
        base = auth_url.rstrip("/")
        self.token_url = base if base.endswith("/oauth/token") else f"{base}/oauth/token"
        self.client_id, self._secret = client_id, client_secret
        self.api_url, self.resource_group = api_url.rstrip("/"), resource_group
        self.http = httpx.Client(timeout=httpx.Timeout(120, connect=10), transport=transport)
        self.clock = clock
        self._token: tuple[str, float] | None = None
        self._lock = threading.Lock()

    def token(self, refresh: bool = False) -> str:
        with self._lock:
            if not refresh and self._token and self._token[1] > self.clock() + 60:
                return self._token[0]
            try:
                r = self.http.post(
                    self.token_url,
                    data={"grant_type": "client_credentials"},
                    auth=(self.client_id, self._secret),
                    timeout=15,
                )
            except httpx.HTTPError as e:
                raise AiCoreError(f"AI Core token request failed: {type(e).__name__}") from e
            if r.status_code != 200:
                # the body of a failed token call can echo the client id; keep it out
                raise AiCoreError(f"AI Core token request: HTTP {r.status_code}", r.status_code)
            body = r.json()
            self._token = (body["access_token"], self.clock() + float(body.get("expires_in", 600)))
            return self._token[0]

    def headers(self, refresh: bool = False) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token(refresh)}",
            "AI-Resource-Group": self.resource_group,
        }

    def _get(self, path: str, **params: Any) -> dict[str, Any]:
        try:
            r = self.http.get(f"{self.api_url}{path}", params=params, headers=self.headers())
        except httpx.HTTPError as e:
            raise AiCoreError(f"AI Core {path}: {type(e).__name__}") from e
        if r.status_code >= 400:
            raise AiCoreError(f"AI Core {path}: HTTP {r.status_code} {r.text[:200]}", r.status_code)
        return r.json()

    def deployment_url(self, model_name: str, deployment_id: str | None = None) -> str:
        """The running foundation-model deployment for `model_name` (or `deployment_id`)."""
        if deployment_id:
            d = self._get(f"/v2/lm/deployments/{deployment_id}")
            if not d.get("deploymentUrl"):
                raise AiCoreError(
                    f"deployment {deployment_id} has no URL (status {d.get('status')})"
                )
            return d["deploymentUrl"]
        found = self._get("/v2/lm/deployments", scenarioId=SCENARIO, status="RUNNING")
        names = []
        for d in found.get("resources", []):
            name = self._model_name(d)
            names.append(name)
            if name == model_name and d.get("deploymentUrl"):
                return d["deploymentUrl"]
        raise AiCoreError(
            f"no RUNNING {SCENARIO} deployment of {model_name} in resource group "
            f"'{self.resource_group}' (found: {', '.join(n for n in names if n) or 'none'})"
        )

    def _model_name(self, d: dict[str, Any]) -> str | None:
        try:
            return d["details"]["resources"]["backend_details"]["model"]["name"]
        except (KeyError, TypeError):
            pass
        if not d.get("configurationId"):
            return None
        conf = self._get(f"/v2/lm/configurations/{d['configurationId']}")
        for b in conf.get("parameterBindings", []):
            if b.get("key") == "modelName":
                return b.get("value")
        return None


def aicore_from_settings(s: Any, what: str) -> AiCore:
    """The AI Core client from the AICORE_* settings; says which ones are missing."""
    values = {
        "AICORE_AUTH_URL": s.aicore_auth_url,
        "AICORE_CLIENT_ID": s.aicore_client_id,
        "AICORE_CLIENT_SECRET": s.aicore_client_secret,
        "AICORE_API_URL": s.aicore_api_url,
    }
    if missing := [k for k in AICORE_VARS if not values[k]]:
        raise RuntimeError(f"{what} needs {', '.join(missing)} (docs/connections.md)")
    return AiCore(
        auth_url=s.aicore_auth_url,
        client_id=s.aicore_client_id,
        client_secret=s.aicore_client_secret.get_secret_value(),
        api_url=s.aicore_api_url,
        resource_group=s.aicore_resource_group,
    )
