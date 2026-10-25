"""v2 step 1: round-trip latency from here to the mock S/4HANA (localhost or BTP).

    SAP_MOCK_ON_BTP=1 uv run python scripts/sap_latency.py [-n 30]    # or: make sap-latency

Measures the calls the agent makes most: a key lookup, a filtered query and the state read.
"""

from __future__ import annotations

import argparse
import statistics
import sys
import time

import httpx

from siaga_common.settings import get_settings

CALLS = {
    "stock lookup": "/A_MaterialStock(Material='MG-2L',Plant='DC-CKR')",
    "filtered PO query": "/A_PurchaseOrder?$filter=YY1_TransportLane eq 'SMG-JKT'",
    "admin state": "/admin/state",
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("-n", type=int, default=30)
    args = ap.parse_args()
    url, headers = get_settings().sap_endpoint()
    print(f"mock S/4HANA at {url}  ({'API key sent' if headers else 'no API key'}), n={args.n}")
    with httpx.Client(base_url=url, headers=headers, timeout=10) as c:
        r = c.get("/admin/state")  # warm-up: TLS handshake, connection reuse after this
        if r.status_code != 200:
            print(f"admin state -> HTTP {r.status_code}: {r.text[:200]}", file=sys.stderr)
            return 1
        for name, path in CALLS.items():
            ms = []
            for _ in range(args.n):
                t0 = time.perf_counter()
                c.get(path).raise_for_status()
                ms.append((time.perf_counter() - t0) * 1000)
            ms.sort()
            p95 = ms[max(0, round(0.95 * len(ms)) - 1)]
            print(
                f"  {name:<18} min {ms[0]:7.1f}  median {statistics.median(ms):7.1f}  "
                f"p95 {p95:7.1f}  max {ms[-1]:7.1f} ms"
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
