"""Turn raw inputs into case signals (PDF text via pypdf)."""

from __future__ import annotations

import io
from pathlib import Path
from typing import Any

from pypdf import PdfReader


def pdf_text(source: Path | str | bytes) -> str:
    reader = PdfReader(io.BytesIO(source) if isinstance(source, bytes) else str(source))
    return "\n".join(page.extract_text() or "" for page in reader.pages).strip()


def build_signals(
    whatsapp: str | None = None,
    pdf_path: Path | str | bytes | None = None,
    pdf_name: str | None = None,
) -> list[dict[str, Any]]:
    signals: list[dict[str, Any]] = []
    if whatsapp and whatsapp.strip():
        signals.append({"type": "whatsapp", "text": whatsapp.strip()})
    if pdf_path:
        signals.append(
            {
                "type": "pdf",
                "filename": pdf_name
                or (Path(pdf_path).name if not isinstance(pdf_path, bytes) else "upload.pdf"),
                "text": pdf_text(pdf_path),
            }
        )
    return signals
