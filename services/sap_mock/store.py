"""State of the mock S/4HANA behind a small interface.

`SapStore` is the seam for Phase 7 (DynamoDB). The SQLite implementation keeps one
generic table `(entity_set, key) -> JSON row`, which maps 1:1 onto a single-table
DynamoDB design, plus a `meta` table for day 0 and number ranges.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Protocol

Row = dict[str, Any]

# Key fields per entity set (composite keys are joined with "|").
KEYS: dict[str, tuple[str, ...]] = {
    "A_Product": ("Product",),
    "A_Plant": ("Plant",),
    "A_Supplier": ("Supplier",),
    "A_PurchaseOrder": ("PurchaseOrder",),
    "A_PurchaseOrderItem": ("PurchaseOrder", "PurchaseOrderItem"),
    "A_SalesOrder": ("SalesOrder",),
    "A_MaterialStock": ("Material", "Plant"),
    "A_TransportLane": ("TransportLane",),
    "A_FreightQuote": ("FreightQuote",),
    "StockTransfer": ("StockTransfer",),
}


def key_of(entity_set: str, row: Row) -> str:
    return "|".join(str(row[f]) for f in KEYS[entity_set])


class SapStore(Protocol):
    def list(self, entity_set: str) -> list[Row]: ...
    def get(self, entity_set: str, key: str) -> Row | None: ...
    def put(self, entity_set: str, row: Row) -> None: ...
    def get_meta(self, name: str) -> str | None: ...
    def set_meta(self, name: str, value: str) -> None: ...
    def next_number(self, counter: str, start: int) -> int: ...
    def replace_all(self, data: dict[str, list[Row]], meta: dict[str, str]) -> None: ...
    def transaction(self) -> Any: ...


class SqliteSapStore:
    def __init__(self, path: Path | str):
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self._lock = threading.RLock()
        self._conn.executescript(
            """
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS entities (
                entity_set TEXT NOT NULL, key TEXT NOT NULL, data TEXT NOT NULL,
                PRIMARY KEY (entity_set, key));
            CREATE TABLE IF NOT EXISTS meta (name TEXT PRIMARY KEY, value TEXT NOT NULL);
            """
        )

    @contextmanager
    def transaction(self) -> Iterator[None]:
        """Serialises read-modify-write action endpoints; nested use is fine."""
        with self._lock:
            outer = not self._conn.in_transaction
            if outer:
                self._conn.execute("BEGIN IMMEDIATE")
            try:
                yield
            except BaseException:
                if outer:
                    self._conn.execute("ROLLBACK")
                raise
            else:
                if outer:
                    self._conn.execute("COMMIT")

    def list(self, entity_set: str) -> list[Row]:
        with self._lock:
            cur = self._conn.execute(
                "SELECT data FROM entities WHERE entity_set = ? ORDER BY key", (entity_set,)
            )
            return [json.loads(d) for (d,) in cur.fetchall()]

    def get(self, entity_set: str, key: str) -> Row | None:
        with self._lock:
            cur = self._conn.execute(
                "SELECT data FROM entities WHERE entity_set = ? AND key = ?", (entity_set, key)
            )
            hit = cur.fetchone()
            return json.loads(hit[0]) if hit else None

    def put(self, entity_set: str, row: Row) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO entities VALUES (?, ?, ?)",
                (entity_set, key_of(entity_set, row), json.dumps(row)),
            )

    def get_meta(self, name: str) -> str | None:
        with self._lock:
            hit = self._conn.execute("SELECT value FROM meta WHERE name = ?", (name,)).fetchone()
            return hit[0] if hit else None

    def set_meta(self, name: str, value: str) -> None:
        with self._lock:
            self._conn.execute("INSERT OR REPLACE INTO meta VALUES (?, ?)", (name, value))

    def next_number(self, counter: str, start: int) -> int:
        with self.transaction():
            current = self.get_meta(f"counter:{counter}")
            n = int(current) + 1 if current else start
            self.set_meta(f"counter:{counter}", str(n))
            return n

    def replace_all(self, data: dict[str, list[Row]], meta: dict[str, str]) -> None:
        with self.transaction():
            self._conn.execute("DELETE FROM entities")
            self._conn.execute("DELETE FROM meta")
            for entity_set, rows in data.items():
                for row in rows:
                    self.put(entity_set, row)
            for name, value in meta.items():
                self.set_meta(name, value)
