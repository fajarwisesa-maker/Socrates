"""Precedent knowledge base. Local BM25 now; Bedrock Knowledge Base (S3 Vectors) in Phase 7."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Protocol

from pydantic import BaseModel
from rank_bm25 import BM25Okapi

from siaga_common.settings import REPO_ROOT

PRECEDENT_DIR = REPO_ROOT / "data" / "demo" / "precedents"
_WORD = re.compile(r"[a-z0-9]+")


class Precedent(BaseModel):
    id: str
    title: str
    tags: list[str]
    text: str
    path: str


class PrecedentHit(BaseModel):
    id: str
    title: str
    tags: list[str]
    score: float
    excerpt: str


class PrecedentKB(Protocol):
    def search(self, query: str, k: int = 3) -> list[PrecedentHit]: ...


def _tokens(text: str) -> list[str]:
    return _WORD.findall(text.lower().replace("_", " "))


def load_precedents(directory: Path = PRECEDENT_DIR) -> list[Precedent]:
    out = []
    for f in sorted(directory.glob("*.md")):
        raw = f.read_text()
        _, front, body = raw.split("---", 2)
        meta = dict(line.split(":", 1) for line in front.strip().splitlines() if ":" in line)
        tags = [t.strip() for t in meta["tags"].strip().strip("[]").split(",")]
        out.append(
            Precedent(
                id=meta["id"].strip(),
                title=meta["title"].strip(),
                tags=tags,
                text=body.strip(),
                path=str(f.relative_to(REPO_ROOT)),
            )
        )
    return out


def _excerpt(text: str) -> str:
    """Action + Lesson paragraphs: what was done and what was learned."""
    keep = [p for p in text.split("\n\n") if p.startswith(("**Action", "**Cost", "**Lesson"))]
    return "\n\n".join(keep) or text[:600]


class LocalBM25KB:
    def __init__(self, directory: Path = PRECEDENT_DIR):
        self.docs = load_precedents(directory)
        # Title and tags weigh in twice: they are the most specific words.
        corpus = [
            _tokens(f"{d.title} {d.title} {' '.join(d.tags * 2)} {d.text}") for d in self.docs
        ]
        self.bm25 = BM25Okapi(corpus)

    def search(self, query: str, k: int = 3) -> list[PrecedentHit]:
        scores = self.bm25.get_scores(_tokens(query))
        ranked = sorted(zip(scores, self.docs, strict=True), key=lambda x: (-x[0], x[1].id))
        return [
            PrecedentHit(
                id=d.id,
                title=d.title,
                tags=d.tags,
                score=round(float(s), 3),
                excerpt=_excerpt(d.text),
            )
            for s, d in ranked[:k]
            if s > 0
        ]
