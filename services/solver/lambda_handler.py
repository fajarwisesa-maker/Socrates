"""Lambda entry point (Phase 7 container image) with the same models as the FastAPI app.

Accepted events:
  * direct invoke:            {"operation": "solve", "payload": {...SolveRequest}}
  * API Gateway proxy (v1/v2): POST /{operation} with the request model as JSON body

How AgentCore Gateway passes tool calls to a Lambda target is verified against the
current AWS docs in Phase 7 before this handler is wired to it.
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


def handler(event: dict[str, Any], context: Any = None) -> dict[str, Any]:
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
