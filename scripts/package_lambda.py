"""Build the solver's Lambda package: build/lambda/solver.zip (make lambda-package).

A plain zip, no Docker: services/solver (without its FastAPI wrapper), siaga_common/timeline,
plus PuLP, pydantic and tzdata
installed for Lambda's platform (Python 3.12, x86_64, manylinux wheels) by uv. PuLP bundles
the CBC binary; only the linux/64 one is kept, with its executable bit, because Lambda
cannot chmod in /var/task. CBC needs only glibc >= 2.4 and libstdc++, which the Lambda
runtime provides; `make aws-setup` proves it with a CBC solve on Lambda (`ping`).

    uv run python scripts/package_lambda.py      # needs network access to PyPI
"""

from __future__ import annotations

import shutil
import stat
import subprocess
import sys
import zipfile
from importlib.metadata import version
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "build" / "lambda"
ZIP = OUT / "solver.zip"
HANDLER = "services.solver.lambda_handler.handler"
# installed at the versions this repo is locked to, so Lambda solves exactly like the laptop
PACKAGES = ["pulp", "pydantic", "pydantic-core", "annotated-types", "typing-extensions",
            "typing-inspection"]  # fmt: skip
SOLVER_FILES = ["__init__.py", "lambda_handler.py", "operations.py", "models.py", "mip.py",
                "risk.py"]  # fmt: skip
# zoneinfo needs a time zone database (the solver formats times in WIB) and Lambda's base
# image may have none, so the tzdata package rides along (not in uv.lock; pinned here)
EXTRA_PINS = ["tzdata==2025.2"]
MAX_ZIP_MB = 50  # direct upload limit of CreateFunction / UpdateFunctionCode


def _install(pkg_dir: Path) -> None:
    pins = [f"{p}=={version(p)}" for p in PACKAGES] + EXTRA_PINS
    cmd = ["uv", "pip", "install", "--quiet", "--target", str(pkg_dir),
           "--python-platform", "x86_64-manylinux_2_28", "--python-version", "3.12",
           "--only-binary", ":all:", "--no-deps", *pins]  # fmt: skip
    subprocess.run(cmd, check=True)


def _strip(pkg_dir: Path) -> None:
    cbc = pkg_dir / "pulp" / "solverdir" / "cbc"
    for platform_dir in cbc.iterdir():
        if platform_dir.is_dir() and platform_dir.name != "linux":
            shutil.rmtree(platform_dir)
    for arch in (cbc / "linux").iterdir():
        if arch.is_dir() and arch.name != "64":
            shutil.rmtree(arch)
    for cache in pkg_dir.rglob("__pycache__"):
        shutil.rmtree(cache, ignore_errors=True)
    binary = cbc / "linux" / "64" / "cbc"
    binary.chmod(binary.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def _zip(pkg_dir: Path) -> None:
    with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for f in sorted(pkg_dir.rglob("*")):
            if f.is_file():
                info = zipfile.ZipInfo.from_file(f, f.relative_to(pkg_dir).as_posix())
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = (f.stat().st_mode & 0xFFFF) << 16  # keep +x on cbc
                z.writestr(info, f.read_bytes())


def build() -> Path:
    pkg = OUT / "pkg"
    shutil.rmtree(OUT, ignore_errors=True)
    (pkg / "services" / "solver").mkdir(parents=True)
    (pkg / "services" / "__init__.py").write_text("", encoding="utf-8")
    (pkg / "siaga_common").mkdir()
    (pkg / "siaga_common" / "__init__.py").write_text("", encoding="utf-8")
    shutil.copy2(ROOT / "siaga_common" / "timeline.py", pkg / "siaga_common" / "timeline.py")
    for name in SOLVER_FILES:
        shutil.copy2(ROOT / "services" / "solver" / name, pkg / "services" / "solver" / name)
    _install(pkg)
    _strip(pkg)
    _zip(pkg)
    mb = ZIP.stat().st_size / 1e6
    if mb > MAX_ZIP_MB:
        raise SystemExit(f"{ZIP} is {mb:.1f} MB, above the {MAX_ZIP_MB} MB direct upload limit")
    return ZIP


def main() -> int:
    path = build()
    print(f"built {path.relative_to(ROOT)} ({path.stat().st_size / 1e6:.1f} MB), "
          f"handler {HANDLER}")  # fmt: skip
    return 0


if __name__ == "__main__":
    sys.exit(main())
