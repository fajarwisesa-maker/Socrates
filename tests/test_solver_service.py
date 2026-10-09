"""FastAPI wrapper and Lambda handler expose the same operations with the same models."""

import json

import pytest
from fastapi.testclient import TestClient

from services.solver.app import create_app
from services.solver.lambda_handler import handler
from services.solver.models import SafetyStockConstraint

B = ["stock_transfer", "alternate_supplier"]


@pytest.fixture
def api():
    return TestClient(create_app())


@pytest.fixture
def solve_payload(plan):
    return plan(B, [SafetyStockConstraint()], request_only=True).model_dump(mode="json")


def test_api_risk_and_solve(api, risk_request, solve_payload):
    r = api.post("/risk", json=risk_request.model_dump(mode="json"))
    assert r.status_code == 200
    assert r.json()["shortfall"] == 900
    assert r.json()["max_exposure"] == 340_000_000
    s = api.post("/solve", json=solve_payload)
    assert s.status_code == 200
    assert s.json()["total_cost"] == 11_400_000
    assert s.json()["actions"][0]["eta"].endswith("Z")


def test_lambda_direct_invoke_matches_api(api, solve_payload):
    via_api = api.post("/solve", json=solve_payload).json()
    via_lambda = handler({"operation": "solve", "payload": solve_payload})
    for result in (via_api, via_lambda):
        result.pop("solve_ms")
    assert via_lambda == via_api


def test_lambda_http_event(solve_payload):
    event = {"rawPath": "/solve", "body": json.dumps(solve_payload)}
    resp = handler(event)
    assert resp["statusCode"] == 200
    assert json.loads(resp["body"])["total_cost"] == 11_400_000


def test_lambda_errors(solve_payload):
    assert handler({"operation": "nope", "payload": {}})["error"]["code"] == "UnknownOperation"
    bad = handler({"operation": "solve", "payload": {**solve_payload, "required_quantity": -1}})
    assert bad["error"]["code"] == "ValidationError"
    http_bad = handler({"rawPath": "/solve", "body": "{}"})
    assert http_bad["statusCode"] == 422
