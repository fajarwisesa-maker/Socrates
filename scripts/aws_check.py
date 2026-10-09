"""Phase 0 AWS check: identity, Claude models in the region, and a tiny Converse call.

Usage:
    uv run python scripts/aws_check.py                 # identity + model list
    uv run python scripts/aws_check.py --probe         # also probe tool use on each Sonnet
    uv run python scripts/aws_check.py --model-id X    # one tiny Converse + tool-use call on X

`list-foundation-models` does not report tool-use support, so "supports tool use" is
proven empirically: a Converse call offering one tool (toolChoice auto - current Claude
models reject forced tool choice) must come back as a toolUse block. temperature=0 is
tried first; if the model rejects it the probe retries without and reports that.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time

import boto3
from botocore.exceptions import BotoCoreError, ClientError

PING_TOOL = {
    "toolSpec": {
        "name": "report_status",
        "description": "Report that the model is reachable.",
        "inputSchema": {
            "json": {
                "type": "object",
                "properties": {"status": {"type": "string", "enum": ["ok"]}},
                "required": ["status"],
            }
        },
    }
}

LEGACY = re.compile(r"claude-(instant|v2|3)", re.IGNORECASE)


def identity(region: str) -> None:
    ident = boto3.client("sts", region_name=region).get_caller_identity()
    print(f"Account: {ident['Account']}  Arn: {ident['Arn']}")


def claude_models(region: str) -> list[dict]:
    bedrock = boto3.client("bedrock", region_name=region)
    models = bedrock.list_foundation_models(byProvider="anthropic")["modelSummaries"]
    active = [
        m
        for m in models
        if m.get("modelLifecycle", {}).get("status") == "ACTIVE" and not LEGACY.search(m["modelId"])
    ]
    profiles: dict[str, list[str]] = {}
    try:
        paginator = bedrock.get_paginator("list_inference_profiles")
        for page in paginator.paginate(typeEquals="SYSTEM_DEFINED"):
            for p in page["inferenceProfileSummaries"]:
                if p.get("status") != "ACTIVE":
                    continue
                for pm in p.get("models", []):
                    model_id = pm["modelArn"].split("/")[-1]
                    profiles.setdefault(model_id, []).append(p["inferenceProfileId"])
    except ClientError as e:  # profiles are optional information
        print(f"(could not list inference profiles: {e.response['Error']['Code']})")
    for m in active:
        m["_profiles"] = sorted(set(profiles.get(m["modelId"], [])))
    return sorted(active, key=lambda m: m["modelId"])


def invocation_id(model: dict) -> str:
    """On-demand models are invoked by model ID; profile-only models by their profile ID."""
    if "ON_DEMAND" in model.get("inferenceTypesSupported", []) or not model["_profiles"]:
        return model["modelId"]
    apac = [p for p in model["_profiles"] if p.startswith("apac.")]
    return (apac or model["_profiles"])[0]


def converse_ping(region: str, model_id: str) -> dict:
    client = boto3.client("bedrock-runtime", region_name=region)
    kwargs = {
        "modelId": model_id,
        "system": [{"text": "You are a connectivity probe. Always answer by calling the tool."}],
        "messages": [{"role": "user", "content": [{"text": "Call report_status with status ok."}]}],
        "inferenceConfig": {"maxTokens": 256, "temperature": 0},
        "toolConfig": {"tools": [PING_TOOL], "toolChoice": {"auto": {}}},
    }
    temperature_ok = True
    t0 = time.perf_counter()
    try:
        resp = client.converse(**kwargs)
    except ClientError as e:
        if "temperature" not in e.response["Error"].get("Message", "").lower():
            raise
        temperature_ok = False
        del kwargs["inferenceConfig"]["temperature"]
        t0 = time.perf_counter()
        resp = client.converse(**kwargs)
    elapsed = time.perf_counter() - t0
    blocks = resp["output"]["message"]["content"]
    tool_use = next((b["toolUse"] for b in blocks if "toolUse" in b), None)
    return {
        "model_id": model_id,
        "latency_s": round(elapsed, 2),
        "stop_reason": resp["stopReason"],
        "temperature_0_accepted": temperature_ok,
        "tool_use": tool_use and {"name": tool_use["name"], "input": tool_use["input"]},
        "usage": resp.get("usage"),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--region", default=None)
    ap.add_argument("--probe", action="store_true", help="probe tool use on every Sonnet model")
    ap.add_argument("--all", action="store_true", help="with --probe: every Claude model")
    ap.add_argument("--model-id", help="make one tiny Converse + tool call with this ID")
    args = ap.parse_args()

    from siaga_common.settings import get_settings

    region = args.region or get_settings().aws_region
    print(f"Region: {region}")
    try:
        identity(region)
        if args.model_id:
            print(json.dumps(converse_ping(region, args.model_id), indent=2, default=str))
            return 0

        models = claude_models(region)
        print(f"\nACTIVE Claude models (non-legacy) in {region}:")
        for m in models:
            print(
                f"  {m['modelId']:<50} {m.get('modelName', ''):<28} "
                f"inference={','.join(m.get('inferenceTypesSupported', []))} "
                f"profiles={','.join(m['_profiles']) or '-'}"
            )
        if args.probe:
            print("\nTool-use probe (toolChoice auto; temperature 0 if accepted):")
            for m in models:
                if not args.all and "sonnet" not in m["modelId"].lower():
                    continue
                mid = invocation_id(m)
                try:
                    r = converse_ping(region, mid)
                    ok = bool(r["tool_use"])
                    temp = "" if r["temperature_0_accepted"] else "  (temperature rejected)"
                    print(f"  {'OK ' if ok else 'NO '} {mid:<55} {r['latency_s']}s{temp}")
                except ClientError as e:
                    err = e.response["Error"]
                    print(f"  ERR {mid:<55} {err['Code']}: {err['Message'][:90]}")
    except (ClientError, BotoCoreError) as e:
        print(f"AWS error: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
