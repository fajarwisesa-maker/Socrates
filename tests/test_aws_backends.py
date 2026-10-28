"""AWS backends: the S3 audit trail (AUDIT_BACKEND=s3) and the Lambda solver
(SOLVER_BACKEND=lambda), plus `make aws-setup`. No network: behaviour runs against small
in-memory stand-ins, and request shapes against botocore's Stubber, which checks every
parameter against the AWS API model of the installed botocore."""

from __future__ import annotations

import io
import json
import stat
import zipfile
from datetime import UTC, datetime
from pathlib import Path

import boto3
import pytest
from botocore.exceptions import ClientError
from botocore.response import StreamingBody
from botocore.stub import ANY, Stubber
from fastapi.testclient import TestClient

from agent.audit import LocalAuditWriter, S3AuditWriter
from agent.case_store import SqliteCaseStore
from agent.clients import HttpSapClient, InProcessSolver, LambdaSolver, SolverBackendError
from agent.machine import Agent
from agent.providers.fake import FakeProvider
from agent.providers.scripts import golden_scripts
from agent.runtime import build_runtime
from agent.signals import build_signals
from api.app import create_app
from scripts import env_mode
from scripts.aws_setup import HANDLER, ROLE, Setup, write_env
from services.solver.lambda_handler import handler
from siaga_common.settings import REPO_ROOT, Settings
from tests.conftest import NOW
from tests.test_api import start_demo_case, wait_status

DEMO = REPO_ROOT / "data" / "demo"
REGION = "ap-southeast-1"
BUCKET = "siaga-audit-123456789012-ap-southeast-1"


def real_client(service: str):
    return boto3.client(service, region_name=REGION, aws_access_key_id="test",
                        aws_secret_access_key="test")  # fmt: skip


def stream(obj) -> StreamingBody:
    raw = json.dumps(obj).encode()
    return StreamingBody(io.BytesIO(raw), len(raw))


# ====================================================================== Lambda solver


class FakeLambda:
    """Runs the real handler, as Lambda would; or fails like AWS does."""

    def __init__(self, fail: str | None = None):
        self.fail = fail
        self.events: list[dict] = []

    def invoke(self, FunctionName, InvocationType, Payload):  # noqa: N803 - boto3 names
        event = json.loads(Payload)
        self.events.append(event)
        if self.fail == "throttle":
            raise ClientError({"Error": {"Code": "TooManyRequestsException",
                                         "Message": "Rate exceeded"}}, "Invoke")  # fmt: skip
        if self.fail == "function":
            timeout = {"errorMessage": "Task timed out after 30.00 seconds"}
            return {"StatusCode": 200, "FunctionError": "Unhandled", "Payload": stream(timeout)}
        return {"StatusCode": 200, "Payload": stream(handler(event))}


def runtime_with(solver, sap, tmp_path):
    clock = lambda: NOW  # noqa: E731
    return build_runtime(
        Settings(_env_file=None),
        sap=HttpSapClient(client=sap),
        solver=solver,
        store=SqliteCaseStore(":memory:", clock),
        audit=LocalAuditWriter(tmp_path / "audit", clock),
        clock=clock,
    )


def run_demo(rt):
    signals = build_signals(
        (DEMO / "whatsapp_driver.txt").read_text(encoding="utf-8"), DEMO / "forwarder_notice.pdf"
    )
    agent = Agent(rt, FakeProvider(golden_scripts()))
    case = agent.start_case(signals, day0="2026-10-28T17:00:00Z")
    return agent.run(case.case_id)


def solver_tool_events(rt, case_id):
    return [
        e for e in rt.store.list_events(case_id)
        if e.status == "tool" and (e.data or {}).get("tool") in ("assess_impact", "simulate_option")
    ]  # fmt: skip


def test_the_demo_on_the_lambda_solver_keeps_the_golden_numbers(sap, tmp_path):
    fake = FakeLambda()
    solver = LambdaSolver("siaga-solver", client=fake, fallback=InProcessSolver())
    rt = runtime_with(solver, sap, tmp_path)
    c = run_demo(rt)
    assert c.status == "AWAITING_APPROVAL", c.escalation_reason
    assert c.summary["chosen_cost"] == 11_400_000 and c.chosen_option == "B2"
    assert any(o["result"]["total_cost"] == 8_100_000 for o in c.solver_results)
    assert {e["operation"] for e in fake.events} >= {"risk", "solve", "compare"}
    events = solver_tool_events(rt, c.case_id)
    assert events and all(e.data["computed_on"] == "aws_lambda" for e in events)
    audited = [a for a in rt.audit.read(c.case_id) if a.kind == "tool_call"
               and a.payload["tool"] == "simulate_option"]  # fmt: skip
    assert audited and all(a.payload["computed_on"] == "aws_lambda" for a in audited)
    assert solver.stats["lambda"] == len(fake.events) and solver.stats["fallback"] == 0
    # tools that do not solve carry no label
    other = [e for e in rt.store.list_events(c.case_id) if e.status == "tool"
             and (e.data or {}).get("tool") == "search_precedents"]  # fmt: skip
    assert other and all(e.data.get("computed_on") is None for e in other)


def test_when_lambda_fails_the_case_solves_in_process_and_says_so(sap, tmp_path):
    solver = LambdaSolver("siaga-solver", client=FakeLambda("throttle"),
                          fallback=InProcessSolver())  # fmt: skip
    rt = runtime_with(solver, sap, tmp_path)
    c = run_demo(rt)
    assert c.status == "AWAITING_APPROVAL" and c.summary["chosen_cost"] == 11_400_000
    events = solver_tool_events(rt, c.case_id)
    assert events and all(e.data["computed_on"] == "in_process_fallback" for e in events)
    assert solver.stats["lambda"] == 0 and solver.stats["fallback"] >= len(events)
    assert "TooManyRequestsException" in solver.stats["last_error"]


def test_lambda_errors_without_fallback():
    from services.solver.models import TimingCheckRequest

    with pytest.raises(SolverBackendError, match="Task timed out"):
        LambdaSolver("f", client=FakeLambda("function")).invoke("risk", {})
    with pytest.raises(SolverBackendError, match="solver refused the request"):
        LambdaSolver("f", client=FakeLambda()).invoke("nope", {})
    with pytest.raises(SolverBackendError, match="TooManyRequests"):
        LambdaSolver("f", client=FakeLambda("throttle")).timing(
            TimingCheckRequest.model_construct()
        )


def test_ping_is_a_real_cbc_solve():
    r = LambdaSolver("f", client=FakeLambda()).ping()
    assert r["ok"] and r["status"] == "Optimal" and r["pulp"] == "2.9.0"


def test_invoke_request_matches_the_lambda_api():
    client = real_client("lambda")
    with Stubber(client) as stub:
        stub.add_response(
            "invoke",
            {"StatusCode": 200, "Payload": stream({"ok": True})},
            {"FunctionName": "siaga-solver", "InvocationType": "RequestResponse",
             "Payload": json.dumps({"operation": "ping", "payload": {}}).encode()},
        )  # fmt: skip
        assert LambdaSolver("siaga-solver", client=client).ping() == {"ok": True}


# ====================================================================== S3 audit


class FakeS3:
    """Objects in memory; can fail the first N puts, or every put."""

    def __init__(self, fail_puts: int = 0):
        self.objects: dict[str, bytes] = {}
        self.fail_puts = fail_puts
        self.puts: list[dict] = []

    def put_object(self, **kw):
        self.puts.append(kw)
        if self.fail_puts:
            self.fail_puts -= 1
            raise ClientError({"Error": {"Code": "RequestTimeout", "Message": "slow"}},
                              "PutObject")  # fmt: skip
        assert kw["Key"] not in self.objects, "an audit object is never overwritten"
        self.objects[kw["Key"]] = kw["Body"]
        return {"ETag": "x"}

    def get_object(self, Bucket, Key):  # noqa: N803
        return {"Body": io.BytesIO(self.objects[Key])}

    def head_object(self, Bucket, Key):  # noqa: N803
        return {"ObjectLockMode": "GOVERNANCE",
                "ObjectLockRetainUntilDate": datetime(2026, 10, 29, tzinfo=UTC)}  # fmt: skip

    def get_paginator(self, name):
        objects = self.objects

        class P:
            def paginate(self, Bucket, Prefix):  # noqa: N803
                yield {"Contents": [{"Key": k} for k in objects if k.startswith(Prefix)]}

        return P()


def s3_writer(tmp_path, s3, **kw) -> S3AuditWriter:
    local = LocalAuditWriter(tmp_path / "audit", lambda: NOW)
    return S3AuditWriter(local, BUCKET, "audit/", client=s3, **kw)


def test_every_entry_is_stored_in_s3_and_verifies_from_s3_alone(tmp_path):
    s3 = FakeS3()
    w = s3_writer(tmp_path, s3)
    for i in range(5):
        w.append("case-a", "tool_call", {"i": i})
    assert w.flush()
    assert sorted(s3.objects) == [f"audit/case-a/{i:06d}.json" for i in range(5)]
    assert s3.puts[0]["ChecksumAlgorithm"] == "SHA256"
    assert s3.puts[0]["Metadata"]["siaga-hash"] == w.read("case-a")[0].hash
    assert w.storage("case-a") | {} == {"backend": "s3", "bucket": BUCKET,
                                        "prefix": "audit/case-a/", "stored": 5, "pending": 0,
                                        "last_error": None}  # fmt: skip
    r = w.verify_remote("case-a")
    assert r["entries"] == 5 and r["chain"]["ok"] and r["matches_local"]
    assert r["object_lock"] == {"mode": "GOVERNANCE", "retain_until": "2026-10-29T00:00:00+00:00"}
    # a changed object in S3 breaks the chain read back from S3
    tampered = json.loads(s3.objects["audit/case-a/000002.json"])
    tampered["payload"]["i"] = 99
    s3.objects["audit/case-a/000002.json"] = json.dumps(tampered).encode()
    r = w.verify_remote("case-a")
    assert not r["chain"]["ok"] and r["chain"]["broken_at"] == 2 and not r["matches_local"]


def test_s3_outages_never_reach_the_case_and_sync_fills_the_gap(tmp_path):
    flaky = FakeS3(fail_puts=2)  # recovers on the third try
    w = s3_writer(tmp_path, flaky, retry_delays=(0.01, 0.01, 0.01))
    w.append("case-b", "case", {"x": 1})
    assert w.flush() and w.storage("case-b")["stored"] == 1
    down = FakeS3(fail_puts=10**6)
    w2 = s3_writer(tmp_path / "2", down, retry_delays=(0.01,))
    for i in range(3):
        w2.append("case-c", "case", {"i": i})  # never raises
    assert w2.flush()
    st = w2.storage("case-c")
    assert st["stored"] == 0 and st["failed"] == 3 and "RequestTimeout" in st["last_error"]
    assert w2.verify("case-c").ok  # the local chain is intact
    down.fail_puts = 0  # back online
    assert w2.sync("case-c") == 3 and w2.sync("case-c") == 0
    assert w2.verify_remote("case-c")["matches_local"]


def test_put_object_matches_the_s3_api(tmp_path):
    client = real_client("s3")
    w = s3_writer(tmp_path, client)
    entry = w.local.append("case-d", "case", {"x": 1})
    with Stubber(client) as stub:
        stub.add_response("put_object", {"ETag": '"x"'}, {
            "Bucket": BUCKET, "Key": "audit/case-d/000000.json", "Body": ANY,
            "ContentType": "application/json", "ChecksumAlgorithm": "SHA256",
            "Metadata": {"siaga-hash": entry.hash, "siaga-prev-hash": entry.prev_hash},
        })  # fmt: skip
        w._put(entry)


def test_case_api_shows_s3_storage_and_verifies_on_demand(runtime, sap, tmp_path):
    s3 = FakeS3()
    runtime.audit = S3AuditWriter(runtime.audit, BUCKET, "audit/", client=s3)
    app = create_app(runtime=runtime, llm=FakeProvider(golden_scripts()), background=False,
                     reset_sap=lambda: {})  # fmt: skip
    with TestClient(app) as api:
        case_id = start_demo_case(api)
        wait_status(api, case_id, "AWAITING_APPROVAL")
        assert runtime.audit.flush()
        body = api.get(f"/cases/{case_id}/audit").json()
        n = len(body["entries"])
        assert body["storage"]["stored"] == n and body["storage"]["bucket"] == BUCKET
        r = api.get(f"/cases/{case_id}/audit/s3").json()
        assert r["entries"] == n and r["chain"]["ok"] and r["matches_local"]


def test_case_api_without_s3(runtime):
    app = create_app(runtime=runtime, llm=FakeProvider(golden_scripts()), background=False,
                     reset_sap=lambda: {})  # fmt: skip
    with TestClient(app) as api:
        case_id = start_demo_case(api)
        assert "storage" not in api.get(f"/cases/{case_id}/audit").json()
        assert api.get(f"/cases/{case_id}/audit/s3").status_code == 409
        assert api.get("/config").json()["backends"]["audit"] == "local"


# ====================================================================== wiring and checks


def test_runtime_wiring():
    rt = build_runtime(Settings(_env_file=None, AUDIT_BACKEND="s3", AUDIT_S3_BUCKET=BUCKET,
                                SOLVER_BACKEND="lambda"))  # fmt: skip
    assert isinstance(rt.audit, S3AuditWriter) and rt.audit.bucket == BUCKET
    assert isinstance(rt.solver, LambdaSolver) and isinstance(rt.solver.fallback, InProcessSolver)
    rt = build_runtime(Settings(_env_file=None, SOLVER_BACKEND="lambda",
                                SOLVER_LAMBDA_FALLBACK="0"))  # fmt: skip
    assert rt.solver.fallback is None
    with pytest.raises(RuntimeError, match="AUDIT_S3_BUCKET"):
        build_runtime(Settings(_env_file=None, AUDIT_BACKEND="s3"))


def test_env_check_asks_for_the_aws_values(tmp_path, monkeypatch):
    for k in ("AWS_PROFILE", "AUDIT_S3_BUCKET", "AUDIT_BACKEND", "SOLVER_BACKEND"):
        monkeypatch.delenv(k, raising=False)
    base = (REPO_ROOT / ".env.local.example").read_text(encoding="utf-8").replace("<set-me>", "x")
    env = tmp_path / ".env"
    env.write_text(base + "AUDIT_BACKEND=s3\nSOLVER_BACKEND=lambda\nAWS_PROFILE=\n",
                   encoding="utf-8")  # fmt: skip
    _, problems = env_mode.check(env, lambda *_: None)
    assert problems == ["AWS_PROFILE missing", "AUDIT_S3_BUCKET missing"]


def test_preflight_lines(capsys):
    from scripts.preflight import aws_lines

    s = Settings(_env_file=None, AUDIT_BACKEND="s3", AUDIT_S3_BUCKET=BUCKET,
                 SOLVER_BACKEND="lambda")  # fmt: skip

    class S3:
        def get_object_lock_configuration(self, Bucket):  # noqa: N803
            return {"ObjectLockConfiguration": {"ObjectLockEnabled": "Enabled", "Rule": {
                "DefaultRetention": {"Mode": "GOVERNANCE", "Days": 1}}}}  # fmt: skip

    aws_lines(s, {"s3": S3(), "lambda": FakeLambda()})
    out = capsys.readouterr().out
    assert f"{BUCKET}: Object Lock GOVERNANCE 1 day(s)" in out
    assert "CBC solve ok on Lambda" in out
    aws_lines(s, {"s3": S3(), "lambda": FakeLambda("throttle")})
    assert "TooManyRequestsException" in capsys.readouterr().out


# ====================================================================== make aws-setup


def setup_with(clients: dict) -> Setup:
    s = Settings(_env_file=None, AWS_REGION=REGION)
    return Setup(s, clients=clients, out=lambda *_: None)


def test_bucket_is_created_with_object_lock_and_no_public_access():
    sts, s3 = real_client("sts"), real_client("s3")
    with Stubber(sts) as st, Stubber(s3) as ss:
        st.add_response("get_caller_identity", {"Account": "123456789012",
                                                "Arn": "arn:aws:iam::123456789012:user/x",
                                                "UserId": "AIDAEXAMPLE"})  # fmt: skip
        ss.add_client_error("head_bucket", "404", http_status_code=404,
                            expected_params={"Bucket": BUCKET})  # fmt: skip
        ss.add_response("create_bucket", {}, {
            "Bucket": BUCKET, "ObjectLockEnabledForBucket": True,
            "CreateBucketConfiguration": {"LocationConstraint": REGION}})  # fmt: skip
        ss.add_response("put_public_access_block", {}, {"Bucket": BUCKET,
            "PublicAccessBlockConfiguration": {"BlockPublicAcls": True, "IgnorePublicAcls": True,
                                               "BlockPublicPolicy": True,
                                               "RestrictPublicBuckets": True}})  # fmt: skip
        ss.add_response("put_object_lock_configuration", {}, {"Bucket": BUCKET,
            "ObjectLockConfiguration": {"ObjectLockEnabled": "Enabled", "Rule": {
                "DefaultRetention": {"Mode": "GOVERNANCE", "Days": 1}}}})  # fmt: skip
        assert setup_with({"sts": sts, "s3": s3}).bucket() == BUCKET
        ss.assert_no_pending_responses()


def test_an_existing_bucket_without_object_lock_is_refused():
    s3 = real_client("s3")
    with Stubber(s3) as ss:
        ss.add_response("head_bucket", {})
        ss.add_client_error("get_object_lock_configuration",
                            "ObjectLockConfigurationNotFoundError")  # fmt: skip
        s = Settings(_env_file=None, AUDIT_S3_BUCKET="old-bucket")
        with pytest.raises(SystemExit, match="Object Lock can only be chosen at creation"):
            Setup(s, clients={"s3": s3}, out=lambda *_: None).bucket()


def test_solver_deploy_creates_role_and_function_then_pings(tmp_path):
    code = tmp_path / "solver.zip"
    with zipfile.ZipFile(code, "w") as z:
        z.writestr("services/solver/lambda_handler.py", "")
    lam, iam = real_client("lambda"), real_client("iam")
    arn = f"arn:aws:iam::123456789012:role/{ROLE}"
    role = {"Role": {"Path": "/", "RoleName": ROLE, "RoleId": "AROAEXAMPLEID123456",
                     "Arn": arn, "CreateDate": datetime(2026, 10, 28)}}  # fmt: skip
    with Stubber(lam) as sl, Stubber(iam) as si:
        sl.add_client_error("get_function", "ResourceNotFoundException", http_status_code=404)
        si.add_client_error("get_role", "NoSuchEntity", http_status_code=404)
        si.add_response("create_role", role, {"RoleName": ROLE, "AssumeRolePolicyDocument": ANY,
                                              "Description": ANY})  # fmt: skip
        si.add_response("attach_role_policy", {}, {"RoleName": ROLE, "PolicyArn": ANY})
        expected = {"FunctionName": "siaga-solver", "Role": arn, "Code": {"ZipFile": ANY},
                    "Architectures": ["x86_64"], "Runtime": "python3.12", "Handler": HANDLER,
                    "Timeout": 30, "MemorySize": 1024, "Description": ANY}  # fmt: skip
        sl.add_client_error("create_function", "InvalidParameterValueException",
                            "The role defined for the function cannot be assumed by Lambda.",
                            expected_params=expected)  # fmt: skip
        sl.add_response("create_function", {"FunctionName": "siaga-solver"}, expected)
        sl.add_response("get_function", {"Configuration": {"State": "Active"}})  # the waiter
        sl.add_response("invoke", {"StatusCode": 200, "Payload": stream(
            {"ok": True, "solve_ms": 9.1, "python": "3.12.11", "machine": "x86_64"})})  # fmt: skip
        r = setup_with({"lambda": lam, "iam": iam}).solver(code, sleep=lambda s: None)
        assert r["ok"]
        sl.assert_no_pending_responses()
        si.assert_no_pending_responses()


def test_write_env_replaces_lines_in_place(tmp_path):
    env = tmp_path / ".env.local"
    env.write_text("A=1\nAUDIT_BACKEND=local\n# AUDIT_BACKEND=comment\n", encoding="utf-8")
    env.chmod(0o600)
    write_env(env, {"AUDIT_BACKEND": "s3", "SOLVER_BACKEND": "lambda"})
    assert env.read_text() == ("A=1\nAUDIT_BACKEND=s3\n# AUDIT_BACKEND=comment\n"
                               "SOLVER_BACKEND=lambda\n")  # fmt: skip
    assert stat.S_IMODE(env.stat().st_mode) == 0o600


def test_package_keeps_only_linux_cbc_and_its_executable_bit(tmp_path, monkeypatch):
    from scripts import package_lambda as pl

    pkg = tmp_path / "pkg"
    for rel in ("linux/64/cbc", "linux/arm64/cbc", "linux/32/cbc", "osx/64/cbc",
                "win/64/cbc.exe"):  # fmt: skip
        f = pkg / "pulp" / "solverdir" / "cbc" / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(b"\x7fELF")
        f.chmod(0o644)
    (pkg / "pulp" / "tests").mkdir()
    (pkg / "pulp" / "tests" / "__init__.py").write_text("")  # pulp imports it at start
    monkeypatch.setattr(pl, "ZIP", tmp_path / "solver.zip")
    pl._strip(pkg)
    pl._zip(pkg)
    with zipfile.ZipFile(tmp_path / "solver.zip") as z:
        names = sorted(z.namelist())
        mode = z.getinfo("pulp/solverdir/cbc/linux/64/cbc").external_attr >> 16
    assert names == ["pulp/solverdir/cbc/linux/64/cbc", "pulp/tests/__init__.py"]
    assert mode & stat.S_IXUSR


def test_built_package_runs_the_handler_alone(tmp_path):
    """If build/lambda/solver.zip exists (make lambda-package), unpack it and solve the
    demo's risk with an isolated interpreter that sees nothing but the package."""
    import subprocess
    import sys

    zip_path = REPO_ROOT / "build" / "lambda" / "solver.zip"
    if not zip_path.exists():
        pytest.skip("run make lambda-package first")
    task = tmp_path / "task"
    with zipfile.ZipFile(zip_path) as z:
        z.extractall(task)
        for info in z.infolist():  # extractall drops the mode; Lambda keeps it
            if info.external_attr >> 16 & stat.S_IXUSR:
                (task / info.filename).chmod(0o755)
    probe = (
        "import json,zoneinfo; zoneinfo.reset_tzpath([]);"
        "from services.solver.lambda_handler import handler;"
        "print(json.dumps(handler({'operation':'ping'})))"
    )
    base = Path(sys.base_prefix) / "bin" / "python3"
    r = subprocess.run([str(base), "-S", "-c", probe], cwd=tmp_path, capture_output=True,
                       text=True, timeout=60, env={"PYTHONPATH": str(task)})  # fmt: skip
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout)["ok"]


# ====================================================================== over the wire


@pytest.fixture
def standin():
    from tests.aws_standin import serve

    server, store = serve()
    yield f"http://127.0.0.1:{server.server_port}", store
    server.shutdown()


def wire_client(service: str, url: str):
    return boto3.client(service, region_name=REGION, endpoint_url=url,
                        aws_access_key_id="test", aws_secret_access_key="test")  # fmt: skip


def test_the_demo_over_real_boto3_and_http(standin, sap, tmp_path, capsys):
    """Real boto3 clients, real HTTP: the Lambda solver and the S3 audit trail together."""
    url, store = standin
    solver = LambdaSolver("siaga-solver", client=wire_client("lambda", url),
                          fallback=InProcessSolver())  # fmt: skip
    rt = runtime_with(solver, sap, tmp_path)
    rt.audit = S3AuditWriter(rt.audit, BUCKET, "audit/", client=wire_client("s3", url))
    c = run_demo(rt)
    assert c.status == "AWAITING_APPROVAL" and c.summary["chosen_cost"] == 11_400_000
    assert solver.stats["fallback"] == 0 and solver.stats["lambda"] == len(store.invocations)
    assert rt.audit.flush(), rt.audit.storage(c.case_id)
    n = len(rt.audit.read(c.case_id))
    assert len([k for b, k in store.objects if b == BUCKET]) == n
    first = store.headers[(BUCKET, f"audit/{c.case_id}/000000.json")]
    assert first.get("x-amz-checksum-sha256") and first.get("x-amz-meta-siaga-hash")
    r = rt.audit.verify_remote(c.case_id)
    assert r["entries"] == n and r["chain"]["ok"] and r["matches_local"]
    assert r["object_lock"]["mode"] == "GOVERNANCE"

    from scripts.preflight import aws_lines

    s = Settings(_env_file=None, AUDIT_BACKEND="s3", AUDIT_S3_BUCKET=BUCKET,
                 SOLVER_BACKEND="lambda")  # fmt: skip
    aws_lines(s, {"s3": wire_client("s3", url), "lambda": wire_client("lambda", url)})
    out = capsys.readouterr().out
    assert "Object Lock GOVERNANCE 1 day(s)" in out and "CBC solve ok on Lambda" in out


def test_a_missing_function_falls_back_and_is_labelled(standin, sap, tmp_path):
    url, _ = standin
    solver = LambdaSolver("not-deployed", client=wire_client("lambda", url),
                          fallback=InProcessSolver())  # fmt: skip
    c = run_demo(runtime_with(solver, sap, tmp_path))
    assert c.summary["chosen_cost"] == 11_400_000
    assert "ResourceNotFoundException" in solver.stats["last_error"]


def test_aws_errors_print_one_line_with_the_fix(monkeypatch, capsys):
    import scripts.aws_setup as aws_setup

    def refuse(argv):
        raise ClientError({"Error": {"Code": "InvalidClientTokenId",
                                     "Message": "The security token is invalid."}},
                          "GetCallerIdentity")  # fmt: skip

    monkeypatch.setattr(aws_setup, "run", refuse)
    assert aws_setup.main(["all"]) == 1
    err = capsys.readouterr().err
    assert "AWS refused: InvalidClientTokenId" in err and "aws sts get-caller-identity" in err
    assert "Traceback" not in err


def test_status_reports_instead_of_crashing():
    class NoAccess:
        def get_caller_identity(self):
            raise ClientError({"Error": {"Code": "ExpiredToken", "Message": "x"}},
                              "GetCallerIdentity")  # fmt: skip

    lines = []
    s = Settings(_env_file=None)
    setup = Setup(s, clients={"sts": NoAccess(), "lambda": FakeLambda("throttle")},
                  out=lines.append)  # fmt: skip
    assert setup.status() == 2
    assert "not ready (ClientError)" in lines[0] and "not ready" in lines[1]
