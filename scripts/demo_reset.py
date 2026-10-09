"""Restore the demo to seed state.

Calls POST {SAP_MOCK_URL}/admin/reset when the mock SAP is running (works the same
against the AWS deployment later); otherwise re-seeds the local SQLite file directly.
Later phases add the case store and audit trail to this reset.
"""

from __future__ import annotations

import sys

import httpx

from siaga_common.settings import get_settings


def main() -> int:
    s = get_settings()
    try:
        r = httpx.post(f"{s.sap_mock_url}/admin/reset", timeout=10)
        r.raise_for_status()
        body = r.json()
        print(f"mock SAP reset via {s.sap_mock_url}: day0={body['day0']} counts={body['counts']}")
        return 0
    except httpx.ConnectError:
        print(f"mock SAP not running at {s.sap_mock_url}; re-seeding {s.sap_db_path} directly")
    except httpx.HTTPError as e:
        print(f"reset failed: {e}", file=sys.stderr)
        return 1

    from services.sap_mock.seed import reset_store
    from services.sap_mock.store import SqliteSapStore

    day0 = reset_store(SqliteSapStore(s.sap_db_path))
    print(f"re-seeded, day0={day0.isoformat()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
