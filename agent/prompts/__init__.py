"""Versioned prompts: <stage>.v<N>.md. The highest version wins unless pinned."""

from __future__ import annotations

import re
from pathlib import Path

DIR = Path(__file__).parent


def load_prompt(stage: str, version: int | None = None) -> tuple[str, str]:
    """Return (text, "stage.vN")."""
    files = {
        int(m.group(1)): f
        for f in DIR.glob(f"{stage}.v*.md")
        if (m := re.fullmatch(rf"{stage}\.v(\d+)\.md", f.name))
    }
    if not files:
        raise FileNotFoundError(f"no prompt for stage {stage!r}")
    v = version or max(files)
    return files[v].read_text().strip(), f"{stage}.v{v}"
