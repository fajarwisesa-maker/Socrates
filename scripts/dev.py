"""Run the demo stack without make or bash (works the same on Windows, macOS and Linux).

    uv run python scripts/dev.py              # LLM per .env
    uv run python scripts/dev.py --fake       # scripted LLM, no AWS
    uv run python scripts/dev.py --replay     # the golden recording, no AWS
    uv run python scripts/dev.py --embedded-sap   # mock SAP inside the Case API (2 processes)
    uv run python scripts/dev.py --multi      # v2: specialist agents (ORCHESTRATION=multi)

Starts the mock S/4HANA (:8001), the Case API (:8000) and the dashboard (:3000), like
`make dev`. Ctrl-C stops all of them; so does any one of them exiting.
"""

from __future__ import annotations

import argparse
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
WINDOWS = os.name == "nt"


def _uvicorn(app: str, port: int) -> list[str]:
    return [
        sys.executable,
        "-m",
        "uvicorn",
        "--factory",
        app,
        "--host",
        "127.0.0.1",
        "--port",
        str(port),
    ]


def _start(name: str, cmd: list[str], cwd: Path, env: dict[str, str]) -> subprocess.Popen:
    print(f"[dev] {name}: {' '.join(cmd)}", flush=True)
    # own process group, so stopping it also stops its children (npm -> node)
    flags = (
        {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
        if WINDOWS
        else {"start_new_session": True}
    )
    return subprocess.Popen(cmd, cwd=cwd, env=env, **flags)


def _stop(p: subprocess.Popen) -> None:
    if p.poll() is not None:
        return
    if WINDOWS:
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(p.pid)], capture_output=True)
    else:
        try:
            os.killpg(p.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
    try:
        p.wait(timeout=10)
    except subprocess.TimeoutExpired:
        p.kill()


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    llm = ap.add_mutually_exclusive_group()
    llm.add_argument("--fake", action="store_true", help="scripted LLM (LLM_PROVIDER=fake)")
    llm.add_argument("--replay", action="store_true", help="replay the golden recording (REPLAY=1)")
    ap.add_argument(
        "--embedded-sap", action="store_true", help="run the mock SAP inside the Case API"
    )
    ap.add_argument("--multi", action="store_true", help="specialist agents (ORCHESTRATION=multi)")
    args = ap.parse_args()

    npm = shutil.which("npm")
    if npm is None:
        print(
            "[dev] npm not found: install Node.js 22 LTS and open a new terminal", file=sys.stderr
        )
        return 1
    if not (REPO_ROOT / "web" / "node_modules").exists():
        print("[dev] web/node_modules missing: run `npm ci` in web/ first", file=sys.stderr)
        return 1

    env = {**os.environ, "PYTHONUTF8": "1"}
    if args.fake:
        env["LLM_PROVIDER"] = "fake"
    if args.replay:
        env["REPLAY"] = "1"
    if args.embedded_sap:
        env["EMBEDDED_SAP"] = "1"
    if args.multi:
        env["ORCHESTRATION"] = "multi"

    def on_term(*_: object) -> None:
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, on_term)
    # a launcher started in the background may inherit an ignored SIGINT; Ctrl-C must work
    signal.signal(signal.SIGINT, signal.default_int_handler)

    procs: list[tuple[str, subprocess.Popen]] = []
    try:
        if not args.embedded_sap:
            procs.append(
                (
                    "mock SAP",
                    _start(
                        "mock SAP",
                        _uvicorn("services.sap_mock.app:create_app", 8001),
                        REPO_ROOT,
                        env,
                    ),
                )
            )
        procs.append(
            ("Case API", _start("Case API", _uvicorn("api.app:create_app", 8000), REPO_ROOT, env))
        )
        procs.append(
            ("dashboard", _start("dashboard", [npm, "run", "dev"], REPO_ROOT / "web", env))
        )
        print("[dev] dashboard: http://localhost:3000  (Ctrl-C stops everything)", flush=True)
        while True:
            for name, p in procs:
                if p.poll() is not None:
                    print(
                        f"[dev] {name} exited with code {p.returncode}; stopping the rest",
                        flush=True,
                    )
                    return p.returncode or 1
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\n[dev] stopping…", flush=True)
        return 0
    finally:
        for _, p in reversed(procs):
            _stop(p)


if __name__ == "__main__":
    sys.exit(main())
