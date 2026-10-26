"""v2 step 1: package the mock S/4HANA for SAP BTP Cloud Foundry -> build/btp/.

    uv run python scripts/package_btp.py      # or: make btp-package
    cd build/btp && cf push --no-start        # exact steps: docs/btp-deploy.md

Only what the mock needs goes in: services/sap_mock (without the in-process helper),
siaga_common (settings, timeline), data/seed, and the committed CF files from deploy/btp/
(manifest.yml, requirements.txt, runtime.txt, .cfignore).
The SQLite file is ephemeral on CF; the app seeds itself on start and POST /admin/reset
re-seeds it (`make demo-reset` calls it when SAP_MOCK_ON_BTP=1).
"""

from __future__ import annotations

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "build" / "btp"
APP = "siaga-sap-mock"
FILES = [
    "services/__init__.py",
    "services/sap_mock/__init__.py",
    "services/sap_mock/app.py",
    "services/sap_mock/odata.py",
    "services/sap_mock/seed.py",
    "services/sap_mock/store.py",
    "siaga_common/__init__.py",
    "siaga_common/settings.py",
    "siaga_common/timeline.py",
]
DEPLOY = ROOT / "deploy" / "btp"  # the committed CF files (manifest, requirements, ...)
CF_FILES = ["manifest.yml", "requirements.txt", "runtime.txt", ".cfignore"]


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    for f in FILES:
        dst = OUT / f
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(ROOT / f, dst)
    shutil.copytree(ROOT / "data" / "seed", OUT / "data" / "seed")
    for f in CF_FILES:
        shutil.copy(DEPLOY / f, OUT / f)
    n = sum(1 for p in OUT.rglob("*") if p.is_file())
    print(f"{n} files -> {OUT}  (app {APP}; push from there: cd build/btp && cf push)")


if __name__ == "__main__":
    main()
