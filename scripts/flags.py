"""The flags in SSM Parameter Store (/siaga/flags/*). None of them is a secret.

    uv run python scripts/flags.py v2      (make flags-v2)   Demo Day values
    uv run python scripts/flags.py v1      (make flags-v1)   every v2 flag off, AWS backends kept
    uv run python scripts/flags.py show    (make flags-show)

Runs on the laptop with AWS_PROFILE (from .env or the shell). The Case API reads the case
flags again at the start of every case, so a change applies to the next case; the backend
settings apply when the deployed processes next start.
"""

from __future__ import annotations

import sys

from siaga_common.settings import export_aws_env, get_settings
from siaga_common.sources import (
    ALL_FLAGS,
    CASE_FLAGS,
    PRESETS,
    ConfigSourceError,
    SsmFlags,
    diff,
    preset,
)


def show(reader: SsmFlags, out=print) -> dict[str, str]:
    values = reader.read()
    v2 = diff(values, PRESETS["v2"])
    v1 = diff(values, PRESETS["v1"])
    which = "= flags-v2" if not v2 else "= flags-v1" if not v1 else "custom"
    out(f"SSM {reader.prefix}*  ({which})")
    for name in ALL_FLAGS:
        when = "each case" if name in CASE_FLAGS else "at start"
        out(f"  {name:<16} {values.get(name, '(not set)'):<10}  applies {when}")
    return values


def main(argv: list[str], reader: SsmFlags | None = None) -> int:
    if argv not in (["v2"], ["v1"], ["show"]):
        print(__doc__)
        return 2
    export_aws_env()
    reader = reader or SsmFlags(get_settings().aws_region)
    try:
        if argv[0] in PRESETS:
            reader.write(preset(argv[0]))
            print(f"set flags-{argv[0]}; the next case runs with them\n")
        show(reader)
    except ConfigSourceError as e:
        print(e, file=sys.stderr)
        return 1
    except Exception as e:  # noqa: BLE001 - botocore errors carry no secret values
        print(f"SSM write failed: {type(e).__name__}: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
