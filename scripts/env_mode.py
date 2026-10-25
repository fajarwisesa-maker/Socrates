"""Laptop env modes: which `.env.<mode>` is active, and is it complete? Never prints a value.

    uv run python scripts/env_mode.py use local|aws|replay|v1   (make use-local / use-aws / ...)
    uv run python scripts/env_mode.py check               (make env-check)

`use` copies `.env.<mode>` to `.env` (the old `.env` is kept in var/env-backup/ unless it
is a copy of a mode file). `.env.replay` has no secrets, so it is made from its template
when missing; `.env.local`, `.env.aws` and `.env.v1` come from scripts/fill-env.sh.
"""

from __future__ import annotations

import filecmp
import os
import shutil
import sys
from datetime import datetime
from pathlib import Path

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent.parent
PLACEHOLDER = "<set-me>"

MODES: dict[str, dict] = {
    "local": {
        "about": "Demo Day: everything on this laptop, live LLM + BTP mock + RPT-1.6",
        "required": [
            "LLM_PROVIDER",
            "AICORE_AUTH_URL",
            "AICORE_CLIENT_ID",
            "AICORE_CLIENT_SECRET",
            "AICORE_API_URL",
            "AICORE_RPT_DEPLOYMENT_ID",
            "SAP_MOCK_BTP_URL",
            "SAP_MOCK_API_KEY",
            "CASE_API_URL",
        ],
        # (variable, value, then also required)
        "required_if": [("LLM_PROVIDER", "bedrock", ["AWS_PROFILE", "BEDROCK_MODEL_ID"])],
        "forbidden": ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"],
    },
    "aws": {
        "about": "Demo Day: dashboard + preflight + rehearse against the deployed Case API",
        "required": [
            "AWS_PROFILE",
            "AWS_REGION",
            "BEDROCK_MODEL_ID",
            "CASE_API_URL",
            "CASE_API_KEY",
            "FLAGS_SOURCE",
        ],
        # laptop rule: a profile, never keys; SAP values live in AWS Secrets Manager
        "forbidden": [
            "AWS_ACCESS_KEY_ID",
            "AWS_SECRET_ACCESS_KEY",
            "AWS_SESSION_TOKEN",
            "AICORE_CLIENT_SECRET",
            "SAP_MOCK_API_KEY",
        ],
    },
    "replay": {
        "about": "offline fallback: everything on this laptop from the golden recording",
        "required": [
            "LLM_PROVIDER",
            "REPLAY",
            "REPLAY_PATH",
            "ORCHESTRATION",
            "DELAY_MODEL",
            "PII_MASKING",
            "SAP_MOCK_URL",
            "CASE_API_URL",
        ],
        "forbidden": ["AICORE_CLIENT_SECRET", "SAP_MOCK_API_KEY", "AWS_SECRET_ACCESS_KEY"],
    },
    "v1": {
        "about": "oldest fallback: v1 behaviour, all v2 flags off, local services + Bedrock",
        "required": [
            "AWS_PROFILE",
            "AWS_REGION",
            "BEDROCK_MODEL_ID",
            "LLM_PROVIDER",
            "SAP_MOCK_URL",
            "CASE_API_URL",
        ],
        "forbidden": ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"],
    },
}


def _is_set(value: str | None) -> bool:
    return bool(value) and value.strip() != PLACEHOLDER


def check(env_file: Path | None = None, out=print) -> tuple[str | None, list[str]]:
    """(mode, problems). Lists every required variable as set / MISSING."""
    path = env_file or ROOT / ".env"
    if not path.exists():
        out(".env: missing (run `make use-replay`, or scripts/fill-env.sh then `make use-aws`)")
        return None, [".env missing"]
    values = dotenv_values(path, encoding="utf-8")
    mode = values.get("SIAGA_MODE")
    if mode not in MODES:
        out(f".env: SIAGA_MODE is {'not set' if not mode else 'unknown'} "
            "(an older hand-made .env? `make use-aws|use-replay|use-v1`)")  # fmt: skip
        return None, ["unknown mode"]
    spec = MODES[mode]
    out(f"mode: {mode} — {spec['about']}")
    problems = []
    required = list(spec["required"])
    for var, value, more in spec.get("required_if", []):
        if (os.environ.get(var) or values.get(var)) == value:
            required += more
    for name in required:
        # a variable already in the shell wins over .env (same as the settings)
        ok = _is_set(os.environ.get(name)) or _is_set(values.get(name))
        out(f"  {name:<18} {'set' if ok else 'MISSING'}")
        if not ok:
            problems.append(f"{name} missing")
    for name in spec["forbidden"]:
        if _is_set(values.get(name)):
            out(f"  {name:<18} should not be in .env in this mode")
            problems.append(f"{name} present")
    if mode == "replay":
        rp = ROOT / (values.get("REPLAY_PATH") or "data/golden/llm.jsonl")
        needs_rpt = values.get("DELAY_MODEL") not in (None, "", "signal")
        for f in [rp] + ([rp.parent / "rpt.jsonl"] if needs_rpt else []):
            exists = f.exists()
            out(f"  {f.relative_to(ROOT)!s:<34} {'present' if exists else 'MISSING'}")
            if not exists:
                problems.append(f"{f.name} missing")
    out("env-check: " + ("ok" if not problems else f"{len(problems)} problem(s)"))
    return mode, problems


def use(mode: str) -> int:
    src = ROOT / f".env.{mode}"
    if not src.exists():
        if mode != "replay":
            print(f"{src.name} does not exist yet: run scripts/fill-env.sh first", file=sys.stderr)
            return 1
        shutil.copyfile(ROOT / ".env.replay.example", src)
        print(f"made {src.name} from .env.replay.example (no secrets in it)")
    dst = ROOT / ".env"
    if dst.exists() and not any(
        (ROOT / f".env.{m}").exists() and filecmp.cmp(dst, ROOT / f".env.{m}", shallow=False)
        for m in MODES
    ):
        backup = ROOT / "var" / "env-backup" / f".env.{datetime.now():%Y%m%d-%H%M%S}"
        backup.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(dst, backup)
        os.chmod(backup, 0o600)
        print(f"kept the previous .env as {backup.relative_to(ROOT)}")
    shutil.copyfile(src, dst)
    os.chmod(dst, 0o600)
    print(f"active mode: {mode} ({src.name} -> .env)\n")
    _, problems = check(dst)
    return 1 if problems else 0


def main(argv: list[str]) -> int:
    if len(argv) == 2 and argv[0] == "use" and argv[1] in MODES:
        return use(argv[1])
    if argv == ["check"]:
        return 1 if check()[1] else 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
