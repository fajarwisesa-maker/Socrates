"""GET /health/connections: what the process running the agent can reach, checked from
inside it (its own IAM role, its own network). `make preflight` reads this instead of
touching the secret from the laptop. Values of secrets never appear in the answer.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime
from typing import Any

import httpx

from siaga_common.settings import Settings
from siaga_common.sources import (
    SECRET_KEYS,
    ConfigSourceError,
    missing_secret_keys,
    read_secret,
    snapshot,
)
from siaga_common.timeline import to_iso


def _check(ok: bool | None, detail: str, **extra: Any) -> dict[str, Any]:
    return {"ok": ok, "detail": detail, **extra}


def _secret(s: Settings) -> dict[str, Any]:
    if s.secrets_source != "aws":
        return _check(None, "SECRETS_SOURCE=env: SAP values come from the environment")
    try:
        values = read_secret(s)
    except ConfigSourceError as e:
        return _check(False, str(e))
    missing = missing_secret_keys(values)
    present = [k for k in SECRET_KEYS if values.get(k)]
    if missing:
        return _check(False, f"{s.sap_secret_id} lacks {', '.join(missing)}", present=present)
    return _check(True, f"{s.sap_secret_id}: {len(present)} keys present", present=present)


def _llm(s: Settings) -> dict[str, Any]:
    """One tiny tool call through the configured provider (and its fallback on its own)."""
    if s.replay or s.llm_provider not in ("bedrock", "sap_genai"):
        return _check(None, f"LLM is {'replay' if s.replay else s.llm_provider}: no model call")
    from agent.providers import make_provider, ping

    try:
        p = make_provider(s.model_copy(update={"llm_record_path": None}))
        targets = (
            [("primary ", p.primary), ("fallback ", p.fallback)]
            if hasattr(p, "fallback")
            else [("", p)]
        )
        parts, ok = [], True
        for label, provider in targets:
            r = ping(provider)
            ok = ok and r["tool_use"]
            call = "tool call ok" if r["tool_use"] else "tool call MISSING"
            parts.append(f"{label}{r['model']}: {call} in {r['latency_s']} s")
    except Exception as e:  # noqa: BLE001
        return _check(False, f"{type(e).__name__}: {str(e)[:160]}")
    return _check(ok, "; ".join(parts))


def _sap(s: Settings, runtime: Any) -> dict[str, Any]:
    """Through the agent's own SAP client (same URL, key and transport as its tool calls)."""
    mode = "BTP" if s.sap_mock_on_btp else "embedded" if s.embedded_sap else "local"
    http = getattr(runtime.sap, "http", None)
    if http is None:
        return _check(None, f"{mode} mock (no HTTP client to probe)", mode=mode)
    try:
        t0 = time.perf_counter()
        r = http.get("/admin/state")
        ms = (time.perf_counter() - t0) * 1000
    except httpx.HTTPError as e:
        return _check(False, f"{mode} mock not reachable: {type(e).__name__}", mode=mode)
    if r.status_code == 401:
        return _check(False, f"{mode} mock refused the API key", mode=mode)
    if r.status_code >= 400:
        return _check(False, f"{mode} mock answered HTTP {r.status_code}", mode=mode)
    key = "API key sent" if "x-api-key" in {k.lower() for k in http.headers} else "no API key"
    return _check(True, f"{mode} mock answers in {ms:.0f} ms ({key})",
                  mode=mode, day0=r.json().get("day0"))  # fmt: skip


def _aicore(s: Settings) -> dict[str, Any]:
    if s.delay_model != "rpt":
        return _check(None, f"DELAY_MODEL={s.delay_model}: no RPT-1.6 call")
    if s.replay or s.llm_provider == "replay":
        return _check(None, "replay: RPT answers come from the recording")
    from agent.delay_model import PredictionUnavailable, demo_query, make_delay_model

    try:
        model = make_delay_model(s)
        assert model is not None
        p = model.predict("health-check", demo_query(to_iso(datetime.now(UTC))))
    except (RuntimeError, PredictionUnavailable) as e:
        return _check(False, str(e)[:200])
    return _check(True, f"token ok; {p.model} predicted {p.prediction:.1f} h in "
                        f"{p.latency_ms:.0f} ms")  # fmt: skip


def check_connections(
    s: Settings, runtime: Any, deep: bool = False, flags_warning: str | None = None
) -> dict[str, Any]:
    backends = {
        "case_store": s.case_store,
        "audit": s.audit_backend,
        "kb": s.kb_backend,
        "policy": s.policy_backend,
        "solver": s.solver_backend,
    }
    checks: dict[str, Any] = {
        "secret": _secret(s),
        "flags": _check(
            None if flags_warning is None else False,
            flags_warning or f"FLAGS_SOURCE={s.flags_source}",
            source=s.flags_source,
            values=snapshot(s),
        ),
        "sap_mock": _sap(s, runtime),
        "backends": _check(
            None, ", ".join(f"{k}={v}" for k, v in backends.items()), values=backends
        ),  # fmt: skip
    }
    if deep:
        checks["llm"] = _llm(s)
        checks["aicore"] = _aicore(s)
    return {"checks": checks, "deep": deep}
