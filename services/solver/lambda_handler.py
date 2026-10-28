"""Lambda entry point (SOLVER_BACKEND=lambda) with the same models as the FastAPI app.

Accepted events:
  * direct invoke:            {"operation": "solve", "payload": {...SolveRequest}}
  * health check:             {"operation": "ping"} -> a tiny CBC solve (proves the bundled
                              solver binary runs in this runtime)
  * API Gateway proxy (v1/v2): POST /{operation} with the request model as JSON body
"""

from __future__ import annotations

import json
from typing import Any

from pydantic import ValidationError

from services.solver.operations import run


def _response(status: int, body: dict[str, Any]) -> dict[str, Any]:
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(body),
    }


def ping() -> dict[str, Any]:
    import platform
    import time

    import pulp

    t0 = time.perf_counter()
    prob = pulp.LpProblem("ping", pulp.LpMinimize)
    x = pulp.LpVariable("x", lowBound=0, cat="Integer")
    prob += x
    prob += x >= 2.5
    status = prob.solve(pulp.PULP_CBC_CMD(msg=False))
    return {
        "ok": pulp.LpStatus[status] == "Optimal" and x.value() == 3,
        "status": pulp.LpStatus[status],
        "solve_ms": round((time.perf_counter() - t0) * 1000, 1),
        "pulp": pulp.__version__,
        "python": platform.python_version(),
        "machine": platform.machine(),
    }


def handler(event: dict[str, Any], context: Any = None) -> dict[str, Any]:
    if event.get("operation") == "ping":
        return ping()
    is_http = "body" in event and ("rawPath" in event or "path" in event)
    if is_http:
        path = event.get("rawPath") or event.get("path") or ""
        operation = path.rstrip("/").rsplit("/", 1)[-1]
        payload = json.loads(event.get("body") or "{}")
    else:
        operation, payload = event.get("operation", ""), event.get("payload", {})
    try:
        result = run(operation, payload)
    except KeyError as e:
        err = {"error": {"code": "UnknownOperation", "message": str(e)}}
        return _response(404, err) if is_http else err
    except ValidationError as e:
        errors = json.loads(json.dumps(e.errors(include_url=False), default=str))
        err = {"error": {"code": "ValidationError", "message": errors}}
        return _response(422, err) if is_http else err
    return _response(200, result) if is_http else result
