"""Environment and secrets setup: secrets from Secrets Manager, flags from SSM read per case,
the Case API key, /health/connections, laptop env modes and the two operator scripts.

No test talks to AWS: boto3 clients are botocore Stubbers, the shell scripts get a stub
`aws` on PATH. Every test that handles a secret also checks it never reaches the output.
"""

from __future__ import annotations

import json
import os
import shutil
import stat
import subprocess
import time

import boto3
import pytest
from botocore.stub import Stubber
from fastapi.testclient import TestClient

from agent.providers.fake import FakeProvider
from agent.providers.scripts import golden_scripts
from api.app import create_app
from scripts import env_mode
from scripts import flags as flags_cli
from siaga_common import sources
from siaga_common.settings import REPO_ROOT, Settings
from siaga_common.sources import (
    FLAGS_V1,
    FLAGS_V2,
    ConfigSourceError,
    SsmFlags,
    missing_secret_keys,
    overlay,
    read_secret,
    snapshot,
    with_secrets,
)

DEMO = REPO_ROOT / "data" / "demo"
SECRET = {
    "AICORE_AUTH_URL": "https://sub.authentication.example.com",
    "AICORE_CLIENT_ID": "sb-client",
    "AICORE_CLIENT_SECRET": "s3cr3t-aicore-value",
    "AICORE_API_URL": "https://api.ai.example.com",
    "AICORE_RPT_DEPLOYMENT_ID": "d123",
    "SAP_MOCK_BTP_URL": "https://siaga-sap-mock.cfapps.example.com",
    "SAP_MOCK_API_KEY": "s3cr3t-btp-key",
    "CASE_API_KEY": "s3cr3t-case-key",
}
SECRET_VALUES = [v for k, v in SECRET.items() if "SECRET" in k or "KEY" in k]


@pytest.fixture(autouse=True)
def _fresh_secret_cache():
    sources.clear_secret_cache()
    yield
    sources.clear_secret_cache()


def secrets_client(payload: str, times: int = 1):
    c = boto3.client("secretsmanager", region_name="ap-southeast-1")
    st = Stubber(c)
    for _ in range(times):
        st.add_response(
            "get_secret_value",
            {"SecretString": payload, "Name": "siaga/sap"},
            {"SecretId": "siaga/sap"},
        )
    st.activate()
    return c, st


# --- settings overlay -------------------------------------------------------------------


def test_overlay_is_pure_and_rederives_the_multi_recording(monkeypatch):
    base = Settings(_env_file=None, MAX_TOOL_CALLS=7)
    multi = overlay(base, {"ORCHESTRATION": "multi", "SAP_MOCK_ON_BTP": "1"})
    assert multi.orchestration == "multi" and multi.sap_mock_on_btp is True
    assert multi.max_tool_calls == 7 and multi.replay_path.parent.name == "multi"
    monkeypatch.setenv("MAX_REPLANS", "9")  # never read again from the environment
    single = overlay(multi, {"ORCHESTRATION": "single"})
    assert single.max_replans == 2 and single.replay_path.parent.name == "golden"
    explicit = overlay(
        Settings(_env_file=None, REPLAY_PATH="x/y.jsonl"), {"ORCHESTRATION": "multi"}
    )
    assert str(explicit.replay_path) == "x/y.jsonl"
    with pytest.raises(ValueError):
        overlay(base, {"ORCHESTRATION": "swarm"})


def test_snapshot_lists_every_flag_as_stored_in_ssm():
    snap = snapshot(overlay(Settings(_env_file=None), FLAGS_V2 | {"CASE_STORE": "sqlite"}))
    assert snap["ORCHESTRATION"] == "multi" and snap["SAP_MOCK_ON_BTP"] == "1"
    assert snap["PII_MASKING"] == "local" and snap["JOULE_APPROVALS"] == "0"
    assert set(snap) == set(FLAGS_V2) | {"BEDROCK_MODEL_ID"} and snap["BEDROCK_MODEL_ID"] == ""


# --- secrets ----------------------------------------------------------------------------


def test_secret_read_once_and_overlaid():
    s = Settings(_env_file=None, SECRETS_SOURCE="aws")
    c, st = secrets_client(json.dumps(SECRET))
    out = with_secrets(s, c)
    assert out.aicore_client_secret.get_secret_value() == "s3cr3t-aicore-value"
    assert out.case_api_key.get_secret_value() == "s3cr3t-case-key"
    assert out.sap_mock_btp_url == SECRET["SAP_MOCK_BTP_URL"]
    assert read_secret(s, c) is read_secret(s, c)  # cached: one call only
    st.assert_no_pending_responses()
    assert missing_secret_keys(read_secret(s, c)) == []  # resource group is optional
    assert "s3cr3t" not in repr(out) and "s3cr3t" not in str(out.model_dump())


def test_secret_errors_name_keys_never_values():
    s = Settings(_env_file=None, SECRETS_SOURCE="aws")
    c, _ = secrets_client("not json s3cr3t-in-a-broken-value")
    with pytest.raises(ConfigSourceError) as e:
        read_secret(s, c)
    assert "s3cr3t" not in str(e.value)
    sources.clear_secret_cache()
    partial = {k: v for k, v in SECRET.items() if k != "SAP_MOCK_API_KEY"}
    c, _ = secrets_client(json.dumps(partial))
    assert missing_secret_keys(read_secret(s, c)) == ["SAP_MOCK_API_KEY"]


def test_env_secrets_untouched():
    s = Settings(_env_file=None)
    assert with_secrets(s) is s


# --- SSM flags --------------------------------------------------------------------------


def ssm_stub(pages: list[dict], writes: dict[str, str] | None = None):
    c = boto3.client("ssm", region_name="ap-southeast-1")
    st = Stubber(c)
    for name, value in (writes or {}).items():
        st.add_response(
            "put_parameter",
            {"Version": 1},
            {"Name": name, "Value": value, "Type": "String", "Overwrite": True},
        )
    for i, page in enumerate(pages):
        params = {"Path": "/siaga/flags/", "Recursive": False}
        if i:
            params["NextToken"] = f"t{i}"
        resp = {"Parameters": [{"Name": f"/siaga/flags/{k}", "Value": v} for k, v in page.items()]}
        if i < len(pages) - 1:
            resp["NextToken"] = f"t{i + 1}"
        st.add_response("get_parameters_by_path", resp, params)
    st.activate()
    return c, st


def test_ssm_flags_read_paginated_and_written(monkeypatch):
    items = list(FLAGS_V2.items())
    c, st = ssm_stub([dict(items[:5]), dict(items[5:]) | {"SOMETHING_ELSE": "x"}])
    assert SsmFlags("ap-southeast-1", client=c).read() == FLAGS_V2  # unknown names ignored
    st.assert_no_pending_responses()
    writes = {f"/siaga/flags/{k}": v for k, v in FLAGS_V1.items()}
    writes["/siaga/flags/BEDROCK_MODEL_ID"] = "apac.model-x"  # copied from the laptop .env
    c, st = ssm_stub([FLAGS_V1], writes)
    out: list[str] = []
    monkeypatch.setattr(
        flags_cli, "get_settings", lambda: Settings(_env_file=None, BEDROCK_MODEL_ID="apac.model-x")
    )
    assert flags_cli.main(["v1"], reader=SsmFlags("ap-southeast-1", client=c)) == 0
    st.assert_no_pending_responses()
    with pytest.raises(ValueError):
        SsmFlags("ap-southeast-1", client=c).write({"NOT_A_FLAG": "1"})
    flags_cli.show(SsmFlags("ap-southeast-1", client=ssm_stub([FLAGS_V1])[0]), out.append)
    assert "= flags-v1" in out[0]


# --- Case API: per-case flags, key, connections -----------------------------------------


class StubFlags:
    def __init__(self, *answers):
        self.answers = list(answers)

    def read(self):
        a = self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]
        if isinstance(a, Exception):
            raise a
        return dict(a)


def start(api) -> str:
    r = api.post(
        "/cases",
        data={"whatsapp": (DEMO / "whatsapp_driver.txt").read_text(encoding="utf-8")},
        files={"pdf": ("n.pdf", (DEMO / "forwarder_notice.pdf").read_bytes(), "application/pdf")},
    )
    assert r.status_code == 202, r.text
    return r.json()["case_id"]


def wait(api, case_id, *statuses, timeout=20.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        case = api.get(f"/cases/{case_id}").json()["case"]
        if case["status"] in statuses:
            return case
        time.sleep(0.05)
    raise AssertionError(f"{case_id} stuck in {case['status']}")


@pytest.fixture
def keyed_api(runtime, sap):
    s = Settings(_env_file=None, LLM_PROVIDER="fake", CASE_API_KEY="s3cr3t-case-key")
    app = create_app(
        s,
        runtime=runtime,
        llm=FakeProvider(golden_scripts()),
        reset_sap=lambda: sap.post("/admin/reset", json={"day0": "2026-10-29"}).json(),
        background=False,
    )
    with TestClient(app) as client:
        yield client


def test_case_api_key_required(keyed_api):
    assert keyed_api.get("/health").status_code == 200  # liveness stays open
    for path in ("/config", "/cases", "/health/connections"):
        assert keyed_api.get(path).status_code == 401
        assert keyed_api.get(path, headers={"X-API-Key": "wrong"}).status_code == 401
    ok = keyed_api.get("/config", headers={"X-API-Key": "s3cr3t-case-key"})
    assert ok.status_code == 200 and "s3cr3t" not in ok.text


def test_flags_read_per_case_and_kept_by_the_case(runtime, sap):
    base = Settings(_env_file=None, LLM_PROVIDER="fake")
    v2_local = {"ORCHESTRATION": "multi", "DELAY_MODEL": "fake", "PII_MASKING": "local"}
    reader = StubFlags({}, v2_local, ConfigSourceError("SSM down"))
    app = create_app(
        base,
        runtime=runtime,
        llm=FakeProvider(golden_scripts()),
        reset_sap=lambda: sap.post("/admin/reset", json={"day0": "2026-10-29"}).json(),
        background=False,
    )
    service = app.state.service
    service.flag_reader = reader
    with TestClient(app) as api:
        first = start(api)  # flags {} -> the startup values (v1)
        c1 = wait(api, first, "AWAITING_APPROVAL")
        second = start(api)  # flags changed in SSM: the next case is multi + delay + PII
        c2 = wait(api, second, "AWAITING_APPROVAL")
        assert c1["flags"]["ORCHESTRATION"] == "single" and c1["delay_prediction"] is None
        assert c2["flags"]["ORCHESTRATION"] == "multi" and c2["delay_prediction"]["status"] == "ok"
        assert c2["pii"]["mode"] == "local"
        assert api.get("/config").json()["orchestration"] == "multi"  # SSM down: last values
        # the first case is approved and verified by the agent it started with
        a1 = next(a for a in c1["actions"] if a.get("approval_id"))["approval_id"]
        assert (
            api.post(f"/cases/{first}/approvals/{a1}", json={"decision": "approve"}).status_code
            == 202
        )
        wait(api, first, "VERIFYING", "RESOLVED")
        assert service.agent_for_case(first) is service.agent
        assert service.agent_for_case(second) is not service.agent
        audit = api.get(f"/cases/{second}/audit").json()["entries"]
        created = next(e for e in audit if e["kind"] == "case")
        assert created["payload"]["flags"]["DELAY_MODEL"] == "fake"
        assert created["payload"]["flags_source"] == "env"
        third = start(api)  # SSM error: last flags read, and the case's audit says so
        audit = api.get(f"/cases/{third}/audit").json()["entries"]
        warning = next(e for e in audit if e["kind"] == "flags_warning")
        assert "SSM down" in warning["payload"]["warning"]
        assert api.get(f"/cases/{third}").json()["case"]["flags"]["ORCHESTRATION"] == "multi"


def test_connections_report_names_never_values(runtime, sap, monkeypatch):
    from agent.runtime import build_runtime

    s = Settings(_env_file=None, LLM_PROVIDER="fake", SECRETS_SOURCE="aws")
    c, _ = secrets_client(json.dumps(SECRET), times=1)
    monkeypatch.setattr(sources, "_client", lambda *a, **k: c)
    rt = build_runtime(
        with_secrets(s),  # as create_app does when it builds the runtime itself
        sap=runtime.sap, solver=runtime.solver, store=runtime.store, audit=runtime.audit,
    )  # fmt: skip
    app = create_app(s, runtime=rt, llm=FakeProvider(golden_scripts()), background=False)
    with TestClient(app) as api:
        h = {"X-API-Key": "s3cr3t-case-key"}  # the key came from the secret
        assert api.get("/config").status_code == 401
        r = api.get("/health/connections?deep=1", headers=h)
    assert r.status_code == 200
    checks = r.json()["checks"]
    assert checks["secret"]["ok"] is True and "CASE_API_KEY" in checks["secret"]["present"]
    assert checks["sap_mock"]["ok"] is True  # through the agent's own SAP client
    assert checks["llm"]["ok"] is None and checks["aicore"]["ok"] is None
    assert checks["backends"]["values"]["case_store"] == "sqlite"
    for v in SECRET_VALUES:
        assert v not in r.text


# --- laptop env modes -------------------------------------------------------------------


def test_env_check_never_prints_values(tmp_path, monkeypatch):
    for name in ("AWS_PROFILE", "CASE_API_KEY", "CASE_API_URL", "BEDROCK_MODEL_ID"):
        monkeypatch.delenv(name, raising=False)
    env = tmp_path / ".env"
    env.write_text(
        "SIAGA_MODE=aws\nAWS_PROFILE=siaga\nAWS_REGION=ap-southeast-1\nBEDROCK_MODEL_ID=<set-me>\n"
        "CASE_API_URL=https://x.execute-api.example.com\nCASE_API_KEY=s3cr3t-case-key\n"
        "FLAGS_SOURCE=ssm\nAWS_SECRET_ACCESS_KEY=s3cr3t-aws\n",
        encoding="utf-8",
    )
    out: list[str] = []
    mode, problems = env_mode.check(env, out.append)
    text = "\n".join(out)
    assert mode == "aws"
    assert problems == ["BEDROCK_MODEL_ID missing", "AWS_SECRET_ACCESS_KEY present"]
    assert "CASE_API_KEY       set" in text and "BEDROCK_MODEL_ID   MISSING" in text
    assert "s3cr3t" not in text and "execute-api" not in text


def test_templates_cover_their_mode_and_are_not_ignored():
    for mode, spec in env_mode.MODES.items():
        example = REPO_ROOT / f".env.{mode}.example"
        names = {
            line.split("=", 1)[0]
            for line in example.read_text(encoding="utf-8").splitlines()
            if "=" in line and not line.startswith("#")
        }
        assert set(spec["required"]) <= names, mode
        assert not set(spec["forbidden"]) & names, mode
        ignored = subprocess.run(["git", "check-ignore", "-q", str(example)], cwd=REPO_ROOT)
        assert ignored.returncode == 1, f"{example.name} must be committed"
        real = subprocess.run(["git", "check-ignore", "-q", f".env.{mode}"], cwd=REPO_ROOT)
        assert real.returncode == 0, f".env.{mode} must be git-ignored"


def test_replay_mode_runs_offline_on_the_v2_recording(tmp_path):
    """The replay template, as is, replays the v2 recording to the golden outcome."""
    from dotenv import dotenv_values

    from scripts.rehearse import api_client, one_run

    values = dotenv_values(REPO_ROOT / ".env.replay.example")
    s = Settings(_env_file=None, **(values | {"REPLAY_SPEED": "0", "VERIFY_DELAY_SECONDS": "0"}))
    assert s.replay and s.delay_model == "rpt" and s.orchestration == "multi"
    assert env_mode.check(REPO_ROOT / ".env.replay.example", lambda *_: None)[1] == []
    import scripts.rehearse as rh

    orig = rh.get_settings
    rh.get_settings = lambda: s
    try:
        with api_client(None, True, 0) as (client, _):
            run = one_run(client, 1, inject=None, timeout=60, verify_wait=30)
    finally:
        rh.get_settings = orig
    assert run["ok"], run


# --- operator scripts (stub aws CLI) ----------------------------------------------------

STUB_AWS = r"""#!/usr/bin/env bash
echo "$*" >> "$STUB_LOG"
case "$*" in
  *"sts get-caller-identity"*) printf '123456789012\tarn:aws:iam::123456789012:user/demo-user\n' ;;
  *"cloudformation describe-stacks"*) echo "https://abc.execute-api.ap-southeast-1.amazonaws.com" ;;
  *"secretsmanager describe-secret"*) exit 255 ;;
  *"secretsmanager create-secret"*) echo "arn:aws:secretsmanager:ap-southeast-1:1:secret:x" ;;
  *"secretsmanager put-secret-value"*)
    for a in "$@"; do
      case "$a" in file://*) cp "${a#file://}" "$STUB_CAPTURE" ;; esac
    done
    echo "v1" ;;
esac
"""


@pytest.fixture
def sandbox(tmp_path):
    root = tmp_path / "repo"
    (root / "scripts").mkdir(parents=True)
    for f in ("fill-env.sh", "put-sap-secret.sh"):
        shutil.copy(REPO_ROOT / "scripts" / f, root / "scripts" / f)
    for m in ("local", "aws", "replay", "v1"):
        shutil.copy(REPO_ROOT / f".env.{m}.example", root / f".env.{m}.example")
    shutil.copy(REPO_ROOT / ".env.example", root / ".env.example")
    bin_ = tmp_path / "bin"
    bin_.mkdir()
    (bin_ / "aws").write_text(STUB_AWS)
    (bin_ / "aws").chmod(0o755)
    env = {
        **os.environ,
        "PATH": f"{bin_}:{os.environ['PATH']}",
        "STUB_LOG": str(tmp_path / "aws.log"),
        "STUB_CAPTURE": str(tmp_path / "secret.json"),
    }
    return root, env, tmp_path


def test_fill_env_writes_private_files_without_echoing_secrets(sandbox):
    root, env, tmp = sandbox
    key_file = tmp / "aicore-key.json"
    key_file.write_text(json.dumps({"credentials": {
        "clientid": SECRET["AICORE_CLIENT_ID"], "clientsecret": SECRET["AICORE_CLIENT_SECRET"],
        "url": SECRET["AICORE_AUTH_URL"] + "/",
        "serviceurls": {"AI_API_URL": SECRET["AICORE_API_URL"]},
    }}))  # fmt: skip
    answers = "\n".join([
        "anthropic.model-x",            # BEDROCK_MODEL_ID (not in .env.example)
        "n",                            # Bedrock not working yet -> sap_genai
        str(key_file),                  # AI Core service key
        "d-rpt-1",                      # RPT deployment id
        SECRET["SAP_MOCK_BTP_URL"] + "/",
        SECRET["SAP_MOCK_API_KEY"],     # hidden
    ]) + "\n"  # fmt: skip
    r = subprocess.run(
        ["bash", "scripts/fill-env.sh"], cwd=root, env=env, input=answers,
        capture_output=True, text=True, timeout=60,
    )  # fmt: skip
    assert r.returncode == 0, r.stdout + r.stderr
    for v in SECRET_VALUES:
        assert v not in r.stdout + r.stderr
    local = (root / ".env.local").read_text()
    assert "<set-me>" not in local and "LLM_PROVIDER=sap_genai" in local
    for k in ("AICORE_AUTH_URL", "AICORE_CLIENT_ID", "AICORE_CLIENT_SECRET", "AICORE_API_URL",
              "SAP_MOCK_BTP_URL", "SAP_MOCK_API_KEY"):  # fmt: skip
        assert f"{k}={SECRET[k]}\n" in local, k  # trailing slashes dropped
    assert "AICORE_RPT_DEPLOYMENT_ID=d-rpt-1" in local
    assert env_mode.check(root / ".env.local", lambda *_: None)[1] == []
    aws = (root / ".env.aws").read_text()
    assert "CASE_API_URL=https://abc.execute-api.ap-southeast-1.amazonaws.com" in aws
    assert "CASE_API_KEY=<set-me>" not in aws and "BEDROCK_MODEL_ID=anthropic.model-x" in aws
    assert "BEDROCK_MODEL_ID=anthropic.model-x" in (root / ".env.v1").read_text()
    for m in ("local", "aws", "replay", "v1"):
        assert stat.S_IMODE((root / f".env.{m}").stat().st_mode) == 0o600


def test_put_sap_secret_creates_and_stores_without_echoing(sandbox):
    root, env, tmp = sandbox
    key_file = tmp / "aicore-key.json"
    key_file.write_text(json.dumps({
        "clientid": SECRET["AICORE_CLIENT_ID"], "clientsecret": SECRET["AICORE_CLIENT_SECRET"],
        "url": SECRET["AICORE_AUTH_URL"],
        "serviceurls": {"AI_API_URL": SECRET["AICORE_API_URL"] + "/"},
    }))  # fmt: skip
    (root / ".env.aws").write_text("CASE_API_KEY=s3cr3t-case-key\n")
    answers = "\n".join([
        str(key_file),          # service key file
        "",                     # resource group -> default
        "d123",                 # deployment id
        SECRET["SAP_MOCK_BTP_URL"],
        SECRET["SAP_MOCK_API_KEY"],
        "y",                    # reuse CASE_API_KEY from .env.aws
    ]) + "\n"  # fmt: skip
    r = subprocess.run(
        ["bash", "scripts/put-sap-secret.sh"], cwd=root, env={**env, "AWS_PROFILE": "siaga"},
        input=answers, capture_output=True, text=True, timeout=60,
    )  # fmt: skip
    assert r.returncode == 0, r.stdout + r.stderr
    for v in SECRET_VALUES:
        assert v not in r.stdout + r.stderr
    assert "user demo-user" in r.stdout
    stored = json.loads((tmp / "secret.json").read_text())
    assert stored == SECRET | {"AICORE_RESOURCE_GROUP": "default"}  # trailing / dropped
    log = (tmp / "aws.log").read_text()
    assert "create-secret" in log and "file://" in log
    for v in SECRET_VALUES:  # never on a command line
        assert v not in log


def test_demo_reset_in_mode_aws_goes_through_the_case_api(monkeypatch):
    import httpx

    from scripts import demo_reset

    calls = []

    def fake_post(url, headers=None, timeout=None):
        calls.append((url, headers))
        return httpx.Response(200, json={"sap": {"day0": "d0"}}, request=httpx.Request("POST", url))

    s = Settings(
        _env_file=None, SIAGA_MODE="aws", CASE_API_URL="https://api.example/", CASE_API_KEY="k"
    )
    monkeypatch.setattr(demo_reset, "get_settings", lambda: s)
    monkeypatch.setattr(demo_reset.httpx, "post", fake_post)
    assert demo_reset.main() == 0
    assert calls == [("https://api.example/demo/reset", {"X-API-Key": "k"})]
