"""v2 step 0 SAP access check. Reports "works" or the exact error for each item; never
prints a secret, token or key.

    uv run python scripts/sap_check.py        # or: make sap-check

1. AI Core: OAuth token (AICORE_AUTH_URL / AICORE_CLIENT_ID / AICORE_CLIENT_SECRET),
   deployments in AICORE_RESOURCE_GROUP (AICORE_API_URL), one tiny call to the RPT
   deployment AICORE_RPT_DEPLOYMENT_ID (5 history rows + 1 row to predict).
2. Cloud Foundry: `cf target` shows the org and space.
3. Joule: `joule status` shows "Logged in".
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import time

import httpx

from agent.delay_model import PredictionUnavailable, RptPredictor, load_history
from siaga_common.settings import get_settings

OK, FAIL = "works", "FAILED"


def line(item: str, status: str, detail: str = "") -> None:
    print(f"  {item:<26} {status:<7} {detail}")


def ai_core() -> bool:
    s = get_settings()
    need = {
        "AICORE_AUTH_URL": s.aicore_auth_url,
        "AICORE_CLIENT_ID": s.aicore_client_id,
        "AICORE_CLIENT_SECRET": s.aicore_client_secret,
        "AICORE_API_URL": s.aicore_api_url,
    }
    if missing := [k for k, v in need.items() if not v]:
        line("AI Core credentials", FAIL, f"not set: {', '.join(missing)}")
        return False
    assert s.aicore_client_secret is not None
    rpt = RptPredictor(
        auth_url=s.aicore_auth_url or "",
        client_id=s.aicore_client_id or "",
        client_secret=s.aicore_client_secret.get_secret_value(),
        api_url=s.aicore_api_url or "",
        deployment_id=s.aicore_rpt_deployment_id or "-",
        resource_group=s.aicore_resource_group,
        history=load_history(s.history_path)[:5],
        timeout=max(s.rpt_timeout_seconds, 15),
    )
    ok = True
    try:
        token = rpt.token(time.monotonic() + 15)
        line("AI Core OAuth token", OK, f"from {rpt.token_url}")
    except httpx.HTTPStatusError as e:
        line("AI Core OAuth token", FAIL, f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        return False
    except httpx.HTTPError as e:
        line("AI Core OAuth token", FAIL, f"{type(e).__name__}: {e}")
        return False

    try:
        r = httpx.get(
            f"{s.aicore_api_url.rstrip('/')}/v2/lm/deployments",  # type: ignore[union-attr]
            headers={
                "Authorization": f"Bearer {token}",
                "AI-Resource-Group": s.aicore_resource_group,
            },
            timeout=15,
        )
        r.raise_for_status()
        deployments = r.json().get("resources", [])
        line(
            "AI Core deployments",
            OK,
            f"{len(deployments)} in resource group '{s.aicore_resource_group}'",
        )
        for d in deployments:
            model = (
                ((d.get("details") or {}).get("resources") or {}).get("backend_details") or {}
            ).get("model", {})
            print(
                f"      {d.get('id')}  {d.get('status'):<9} {d.get('configurationName') or ''}  "
                f"{model.get('name') or ''} {model.get('version') or ''}"
            )
    except httpx.HTTPStatusError as e:
        ok = False
        line("AI Core deployments", FAIL, f"HTTP {e.response.status_code}: {e.response.text[:200]}")
    except httpx.HTTPError as e:
        ok = False
        line("AI Core deployments", FAIL, f"{type(e).__name__}: {e}")

    if not s.aicore_rpt_deployment_id:
        line("RPT-1.6 prediction", FAIL, "AICORE_RPT_DEPLOYMENT_ID not set")
        return False
    query = {
        "cause": "flood",
        "corridor": "Pantura",
        "month": 10,
        "rain_level": None,
        "signal_sources": 2,
        "official_notice": "y",
    }
    try:
        p = rpt.predict("sap-check", query)
        ci = f", interval {p.interval[0]:.1f}-{p.interval[1]:.1f}" if p.interval else ""
        line(
            "RPT-1.6 prediction",
            OK,
            f"{p.prediction:.1f} h{ci} in {p.latency_ms:.0f} ms (5 context rows)",
        )
    except PredictionUnavailable as e:
        ok = False
        line("RPT-1.6 prediction", FAIL, str(e))
    return ok


def cli(item: str, cmd: list[str], expect: str) -> bool:
    if not shutil.which(cmd[0]):
        line(item, FAIL, f"`{cmd[0]}` is not installed on this machine")
        return False
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    except subprocess.TimeoutExpired:
        line(item, FAIL, f"`{' '.join(cmd)}` timed out")
        return False
    text = (out.stdout + out.stderr).strip()
    good = out.returncode == 0 and expect.lower() in text.lower()
    first = " | ".join(x.strip() for x in text.splitlines() if x.strip())[:200]
    line(item, OK if good else FAIL, first)
    return good


def main() -> int:
    print("SAP access check")
    results = [
        ai_core(),
        cli("Cloud Foundry target", ["cf", "target"], "space:"),
        cli("Joule CLI", ["joule", "status"], "logged in"),
    ]
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
