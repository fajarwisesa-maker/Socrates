"""v2 step 3 (DELAY_MODEL): a learned delay prediction for ASSESS from SAP RPT-1.6.

SAP RPT-1.6 is a tabular foundation model on SAP AI Core, not an LLM. It gets the synthetic
disruption history (data/history/disruptions.csv) as context rows plus one row for this case
whose `delay_hours` is the placeholder "[PREDICT]", as a regression task, and returns a point
estimate with a confidence interval.

Code, not a model, combines it with Perceive's signal range (rule agreed with the product
owner, 25 Oct):
- prediction inside the signal range -> the risk function uses that delay (a point);
- outside -> clamped to the nearest bound and flagged "Model and signal disagree";
- RPT unavailable (error, or no answer within RPT_TIMEOUT_SECONDS) -> the signal range, with
  a neutral "Prediction unavailable" event.
The risk function still computes every probability and amount.

API shape from the SAP Cloud SDK for AI (`@sap-ai-sdk/rpt` 2.17.0 generated types):
POST {AICORE_API_URL}/v2/inference/deployments/{id}/predict, header AI-Resource-Group;
body {prediction_config: {target_columns: [{name, prediction_placeholder, task_type}]},
index_column, rows}; response {id, status, predictions: [{<index>: id, <target>: [{prediction,
confidence (null for regression), confidence_interval: [lo, hi]}]}], metadata}.
"""

from __future__ import annotations

import csv
import hashlib
import json
import threading
import time
from collections import defaultdict
from collections.abc import Callable
from pathlib import Path
from statistics import median
from typing import Any, Protocol

import httpx
from pydantic import BaseModel

from siaga_common.settings import Settings
from siaga_common.timeline import WIB, from_iso

TARGET = "delay_hours"
PLACEHOLDER = "[PREDICT]"
INDEX = "id"
QUERY_ID = "QUERY"
FEATURES = ("cause", "corridor", "month", "rain_level", "signal_sources", "official_notice")
# Lane -> corridor vocabulary of the history (SMG-JKT is "Pantura" in SAP's lane master too).
LANE_CORRIDOR = {
    "SMG-JKT": "Pantura",
    "BDG-CKR": "Trans-Java toll",
    "SBY-JKT": "Trans-Java toll",
    "TPR-CKR": "Tanjung Priok",
    "MRK-BKS": "Merak-Bakauheni",
}
RPT_LABEL = "SAP RPT-1.6"
DISAGREE = "Model and signal disagree"


class Prediction(BaseModel):
    provider: str  # rpt | fake | replay
    model: str  # what made the number, as shown to people
    prediction: float
    interval: tuple[float, float] | None = None
    history_rows: int
    latency_ms: float = 0.0
    raw: dict[str, Any] = {}


class PredictionUnavailable(Exception):
    """RPT did not answer usefully (error, timeout, bad payload); use the signal range."""


class DelayPredictor(Protocol):
    name: str

    def predict(self, case_id: str, query: dict[str, Any]) -> Prediction: ...


# ---------------------------------------------------------------- data


def load_history(path: Path) -> list[dict[str, Any]]:
    """The context rows ('#' lines are the file's synthetic-data header)."""
    with path.open(encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(line for line in f if not line.startswith("#")))
    for r in rows:
        r["month"] = int(r["month"])
        r["signal_sources"] = int(r["signal_sources"])
        r[TARGET] = float(r[TARGET])
    return rows


def query_row(
    disruption: dict[str, Any], signals: list[dict[str, Any]], created_at: str
) -> dict[str, Any]:
    """This case's features, all from the case record (never from a model's arguments).
    Rain level is not observed by any signal, so it is left unknown (null)."""
    return {
        "cause": disruption["cause"],
        "corridor": LANE_CORRIDOR.get(disruption.get("lane") or "", "other"),
        "month": from_iso(created_at).astimezone(WIB).month,
        "rain_level": None,
        "signal_sources": len(signals),
        "official_notice": "y" if any(s["type"] == "pdf" for s in signals) else "n",
    }


def request_body(history: list[dict[str, Any]], query: dict[str, Any]) -> dict[str, Any]:
    rows = [{INDEX: r[INDEX], **{k: r[k] for k in FEATURES}, TARGET: r[TARGET]} for r in history]
    rows.append({INDEX: QUERY_ID, **query, TARGET: PLACEHOLDER})
    return {
        "prediction_config": {
            "target_columns": [
                {"name": TARGET, "prediction_placeholder": PLACEHOLDER, "task_type": "regression"}
            ]
        },
        "index_column": INDEX,
        "rows": rows,
    }


def parse_response(payload: dict[str, Any]) -> tuple[float, tuple[float, float] | None]:
    """(prediction, confidence interval) for the query row; ValueError if absent."""
    status = payload.get("status") or {}
    if status.get("code", 0) not in (0, None):
        raise ValueError(f"RPT status {status.get('code')}: {status.get('message')}")
    for p in payload.get("predictions") or []:
        if p.get(INDEX) == QUERY_ID or len(payload["predictions"]) == 1:
            result = p[TARGET][0]
            ci = result.get("confidence_interval")
            return float(result["prediction"]), (float(ci[0]), float(ci[1])) if ci else None
    raise ValueError("no prediction for the query row in the RPT response")


# ---------------------------------------------------------------- the rule (code)


def combine(
    prediction: Prediction | None,
    signal_min: float,
    signal_max: float,
    query: dict[str, Any],
    reason: str | None = None,
) -> dict[str, Any]:
    """The delay the risk function uses, and why."""
    out: dict[str, Any] = {
        "signal_range_hours": [signal_min, signal_max],
        "features": query,
    }
    if prediction is None:
        return out | {
            "status": "unavailable",
            "reason": reason,
            "used": "signal",
            "delay_for_risk_hours": [signal_min, signal_max],
            "disagree": False,
            "flag": None,
        }
    p = round(prediction.prediction, 1)
    used = min(max(p, signal_min), signal_max)
    disagree = used != p
    return out | {
        "status": "ok",
        "provider": prediction.provider,
        "model": prediction.model,
        "predicted_hours": p,
        "interval_hours": [round(x, 1) for x in prediction.interval]
        if prediction.interval
        else None,
        "history_rows": prediction.history_rows,
        "latency_ms": prediction.latency_ms,
        "used": "clamped" if disagree else "prediction",
        "delay_for_risk_hours": [used, used],
        "disagree": disagree,
        "flag": DISAGREE if disagree else None,
    }


# ---------------------------------------------------------------- predictors


class RptPredictor:
    """SAP RPT-1.6 on SAP AI Core (OAuth client credentials; token cached)."""

    name = "rpt"

    def __init__(
        self,
        *,
        auth_url: str,
        client_id: str,
        client_secret: str,
        api_url: str,
        deployment_id: str,
        resource_group: str,
        history: list[dict[str, Any]],
        timeout: float = 5.0,
        transport: httpx.BaseTransport | None = None,
        clock: Callable[[], float] = time.monotonic,
    ):
        base = auth_url.rstrip("/")
        self.token_url = base if base.endswith("/oauth/token") else f"{base}/oauth/token"
        self.client_id, self.client_secret = client_id, client_secret
        self.predict_url = f"{api_url.rstrip('/')}/v2/inference/deployments/{deployment_id}/predict"
        self.resource_group = resource_group
        self.history = history
        self.timeout = timeout
        self.transport = transport
        self.clock = clock
        self._token: tuple[str, float] | None = None
        self._lock = threading.Lock()

    def _client(self, timeout: float) -> httpx.Client:
        return httpx.Client(timeout=timeout, transport=self.transport)

    def token(self, deadline: float) -> str:
        with self._lock:
            if self._token and self._token[1] > self.clock() + 60:
                return self._token[0]
            with self._client(max(0.1, deadline - self.clock())) as c:
                r = c.post(
                    self.token_url,
                    data={"grant_type": "client_credentials"},
                    auth=(self.client_id, self.client_secret),
                )
            r.raise_for_status()
            body = r.json()
            self._token = (body["access_token"], self.clock() + float(body.get("expires_in", 600)))
            return self._token[0]

    def predict(self, case_id: str, query: dict[str, Any]) -> Prediction:
        t0 = self.clock()
        deadline = t0 + self.timeout  # one budget for token + prediction
        try:
            token = self.token(deadline)
            with self._client(max(0.1, deadline - self.clock())) as c:
                r = c.post(
                    self.predict_url,
                    json=request_body(self.history, query),
                    headers={
                        "Authorization": f"Bearer {token}",
                        "AI-Resource-Group": self.resource_group,
                    },
                )
            r.raise_for_status()
            payload = r.json()
            value, interval = parse_response(payload)
        except httpx.TimeoutException as e:
            raise PredictionUnavailable(f"no answer within {self.timeout:g} s") from e
        except httpx.HTTPStatusError as e:
            raise PredictionUnavailable(
                f"AI Core HTTP {e.response.status_code}: {e.response.text[:200]}"
            ) from e
        except (httpx.HTTPError, ValueError, KeyError, TypeError, IndexError) as e:
            raise PredictionUnavailable(f"{type(e).__name__}: {e}") from e
        return Prediction(
            provider=self.name,
            model=RPT_LABEL,
            prediction=value,
            interval=interval,
            history_rows=len(self.history),
            latency_ms=round((self.clock() - t0) * 1000, 1),
            raw=payload,
        )


class FakePredictor:
    """Offline stand-in for tests and runs without SAP (DELAY_MODEL=fake). Not RPT: the
    median of the history rows with the same cause and corridor, labelled as such."""

    name = "fake"

    def __init__(self, history: list[dict[str, Any]]):
        self.history = history

    def predict(self, case_id: str, query: dict[str, Any]) -> Prediction:
        same = [
            r[TARGET]
            for r in self.history
            if r["cause"] == query["cause"] and r["corridor"] == query["corridor"]
        ] or [r[TARGET] for r in self.history if r["cause"] == query["cause"]]
        if not same:
            raise PredictionUnavailable("no similar rows in the history")
        return Prediction(
            provider=self.name,
            model="offline stand-in (not RPT): median of similar past disruptions",
            prediction=median(same),
            interval=(min(same), max(same)),
            history_rows=len(self.history),
        )


class RecordingPredictor:
    """Records every prediction (or failure) of a run, for the golden replay."""

    def __init__(self, inner: DelayPredictor, path: Path):
        self.inner, self.path = inner, path
        self.name = inner.name
        self.index = 0
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("", encoding="utf-8")

    def predict(self, case_id: str, query: dict[str, Any]) -> Prediction:
        entry: dict[str, Any] = {
            "index": self.index,
            "request_digest": hashlib.sha256(
                json.dumps(query, sort_keys=True).encode()
            ).hexdigest()[:16],
        }
        self.index += 1
        try:
            p = self.inner.predict(case_id, query)
            entry["prediction"] = p.model_dump(mode="json")
            return p
        except PredictionUnavailable as e:
            entry["unavailable"] = str(e)
            raise
        finally:
            with self.path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")


class ReplayPredictor:
    """Serves recorded predictions in order, per case. Never touches the network."""

    name = "replay"

    def __init__(self, path: Path):
        if not path.exists():
            raise RuntimeError(
                f"REPLAY with DELAY_MODEL set needs {path} (record it with "
                "`DELAY_MODEL=rpt make record-golden`)"
            )
        self.entries = [
            json.loads(line)
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        self.cursor: dict[str, int] = defaultdict(int)
        self._lock = threading.Lock()

    def predict(self, case_id: str, query: dict[str, Any]) -> Prediction:
        with self._lock:
            i = self.cursor[case_id]
            self.cursor[case_id] += 1
        if i >= len(self.entries):
            raise PredictionUnavailable("the case left the recorded path (no more predictions)")
        e = self.entries[i]
        if "unavailable" in e:
            raise PredictionUnavailable(e["unavailable"])
        return Prediction.model_validate(e["prediction"])


def demo_query(created_at: str) -> dict[str, Any]:
    """The demo case's row (Perceive's reading of the two demo signals), for previews and
    connection checks that must not open a case."""
    from agent.signals import build_signals
    from siaga_common.settings import REPO_ROOT

    demo = REPO_ROOT / "data" / "demo"
    signals = build_signals(
        (demo / "whatsapp_driver.txt").read_text(encoding="utf-8"), demo / "forwarder_notice.pdf"
    )
    return query_row({"cause": "flood", "lane": "SMG-JKT"}, signals, created_at)


def make_delay_model(settings: Settings) -> DelayPredictor | None:
    if settings.delay_model == "signal":
        return None
    if settings.replay or settings.llm_provider == "replay":
        return ReplayPredictor(settings.replay_path.parent / "rpt.jsonl")
    history = load_history(settings.history_path)
    if settings.delay_model == "fake":
        return FakePredictor(history)
    need = {
        "AICORE_AUTH_URL": settings.aicore_auth_url,
        "AICORE_CLIENT_ID": settings.aicore_client_id,
        "AICORE_CLIENT_SECRET": settings.aicore_client_secret,
        "AICORE_API_URL": settings.aicore_api_url,
        "AICORE_RPT_DEPLOYMENT_ID": settings.aicore_rpt_deployment_id,
    }
    if missing := [k for k, v in need.items() if not v]:
        raise RuntimeError(f"DELAY_MODEL=rpt needs {', '.join(missing)} (see docs/v2-flags.md)")
    assert settings.aicore_client_secret is not None
    return RptPredictor(
        auth_url=settings.aicore_auth_url or "",
        client_id=settings.aicore_client_id or "",
        client_secret=settings.aicore_client_secret.get_secret_value(),
        api_url=settings.aicore_api_url or "",
        deployment_id=settings.aicore_rpt_deployment_id or "",
        resource_group=settings.aicore_resource_group,
        history=history,
        timeout=settings.rpt_timeout_seconds,
    )
