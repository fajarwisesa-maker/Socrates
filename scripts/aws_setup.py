"""Create the AWS side of SIAGA's S3 audit trail and Lambda solver, and switch .env.local to them.

    make aws-setup            # = all: bucket + solver + .env.local lines (idempotent)
    uv run python scripts/aws_setup.py bucket|solver|status|verify-audit <case>|sync-audit

Uses the laptop's AWS profile (AWS_PROFILE in .env) and AWS_REGION; prints no secret.

- **Audit bucket** `siaga-audit-<account>-<region>` (or AUDIT_S3_BUCKET): created with Object
  Lock (versioning comes with it), a default retention of AUDIT_RETENTION_DAYS days in
  GOVERNANCE mode, and all public access blocked. Governance mode means an admin with
  s3:BypassGovernanceRetention can still remove an object; compliance mode could not be
  undone even by the account root, so it is not used for a prototype.
- **Solver**: IAM role `siaga-solver-lambda` (Lambda trust + AWSLambdaBasicExecutionRole for
  its logs), then function SOLVER_LAMBDA_NAME (python3.12, x86_64, 1024 MB, 30 s) from
  build/lambda/solver.zip (scripts/package_lambda.py), then one `ping`: a CBC solve on
  Lambda, which proves the bundled solver binary runs there.
- **.env.local**: AUDIT_BACKEND=s3, AUDIT_S3_BUCKET=..., SOLVER_BACKEND=lambda (lines
  replaced in place); then `make use-local`.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from siaga_common.settings import Settings, export_aws_env, get_settings  # noqa: E402

ROLE = "siaga-solver-lambda"
BASIC_LOGS = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
HANDLER = "services.solver.lambda_handler.handler"
TRUST = {
    "Version": "2012-10-17",
    "Statement": [{"Effect": "Allow", "Principal": {"Service": "lambda.amazonaws.com"},
                   "Action": "sts:AssumeRole"}],
}  # fmt: skip


class Setup:
    def __init__(self, s: Settings, clients: dict[str, Any] | None = None, out=print):
        self.s = s
        self.region = s.aws_region
        self._clients = clients or {}
        self.out = out

    def client(self, name: str) -> Any:
        if name not in self._clients:
            import boto3

            self._clients[name] = boto3.client(name, region_name=self.region)
        return self._clients[name]

    def account(self) -> str:
        return self.client("sts").get_caller_identity()["Account"]

    def bucket_name(self) -> str:
        return self.s.audit_s3_bucket or f"siaga-audit-{self.account()}-{self.region}"

    # ------------------------------------------------------------------ audit bucket
    def bucket(self) -> str:
        from botocore.exceptions import ClientError

        s3, name = self.client("s3"), self.bucket_name()
        try:
            s3.head_bucket(Bucket=name)
            exists = True
        except ClientError as e:
            if e.response["Error"]["Code"] not in ("404", "NoSuchBucket", "NotFound"):
                code = e.response["Error"]["Code"]
                raise SystemExit(
                    f"bucket {name}: {code} (owned by someone else? set AUDIT_S3_BUCKET)"
                ) from e
            exists = False
        if not exists:
            kw: dict[str, Any] = {"Bucket": name, "ObjectLockEnabledForBucket": True}
            if self.region != "us-east-1":
                kw["CreateBucketConfiguration"] = {"LocationConstraint": self.region}
            s3.create_bucket(**kw)
            self.out(f"created bucket {name} with Object Lock")
        else:
            try:
                lock = s3.get_object_lock_configuration(Bucket=name)["ObjectLockConfiguration"]
            except ClientError as e:
                raise SystemExit(f"bucket {name} exists without Object Lock; Object Lock can "
                                 "only be chosen at creation: set AUDIT_S3_BUCKET to a new "
                                 "name") from e  # fmt: skip
            if lock.get("ObjectLockEnabled") != "Enabled":
                raise SystemExit(f"bucket {name} exists without Object Lock")
        s3.put_public_access_block(
            Bucket=name,
            PublicAccessBlockConfiguration={"BlockPublicAcls": True, "IgnorePublicAcls": True,
                                            "BlockPublicPolicy": True,
                                            "RestrictPublicBuckets": True},
        )  # fmt: skip
        days = self.s.audit_retention_days
        s3.put_object_lock_configuration(
            Bucket=name,
            ObjectLockConfiguration={
                "ObjectLockEnabled": "Enabled",
                "Rule": {"DefaultRetention": {"Mode": "GOVERNANCE", "Days": days}},
            },
        )
        self.out(f"bucket {name}: Object Lock GOVERNANCE {days} day(s), public access blocked")
        return name

    # ------------------------------------------------------------------ solver
    def role_arn(self) -> str:
        from botocore.exceptions import ClientError

        iam = self.client("iam")
        try:
            return iam.get_role(RoleName=ROLE)["Role"]["Arn"]
        except ClientError as e:
            if e.response["Error"]["Code"] != "NoSuchEntity":
                raise
        arn = iam.create_role(
            RoleName=ROLE,
            AssumeRolePolicyDocument=json.dumps(TRUST),
            Description="SIAGA solver Lambda: CloudWatch Logs only",
        )["Role"]["Arn"]
        iam.attach_role_policy(RoleName=ROLE, PolicyArn=BASIC_LOGS)
        self.out(f"created IAM role {ROLE}")
        return arn

    def solver(self, zip_path: Path | None = None, sleep=time.sleep) -> dict[str, Any]:
        from botocore.exceptions import ClientError

        if zip_path is None:
            from scripts.package_lambda import build

            zip_path = build()
        code = Path(zip_path).read_bytes()
        lam, name = self.client("lambda"), self.s.solver_lambda_name
        config = {
            "Runtime": "python3.12",
            "Handler": HANDLER,
            "Timeout": 30,
            "MemorySize": 1024,
            "Description": "SIAGA solver: risk + MIP (PuLP/CBC)",
        }
        try:
            lam.get_function(FunctionName=name)
            exists = True
        except ClientError as e:
            if e.response["Error"]["Code"] != "ResourceNotFoundException":
                raise
            exists = False
        if exists:
            lam.update_function_code(FunctionName=name, ZipFile=code)
            lam.get_waiter("function_updated_v2").wait(FunctionName=name)
            lam.update_function_configuration(FunctionName=name, **config)
            lam.get_waiter("function_updated_v2").wait(FunctionName=name)
            self.out(f"updated Lambda {name}")
        else:
            role = self.role_arn()
            for attempt in range(12):  # a new role takes a few seconds to be assumable
                try:
                    lam.create_function(FunctionName=name, Role=role, Code={"ZipFile": code},
                                        Architectures=["x86_64"], **config)  # fmt: skip
                    break
                except ClientError as e:
                    msg = e.response["Error"].get("Message", "")
                    if "cannot be assumed" not in msg or attempt == 11:
                        raise
                    sleep(5)
            lam.get_waiter("function_active_v2").wait(FunctionName=name)
            self.out(f"created Lambda {name}")
        return self.ping()

    def ping(self) -> dict[str, Any]:
        from agent.clients import LambdaSolver

        r = LambdaSolver(self.s.solver_lambda_name, client=self.client("lambda")).ping()
        state = "ok" if r.get("ok") else "FAILED"
        self.out(f"Lambda {self.s.solver_lambda_name}: CBC solve {state} in {r.get('solve_ms')} "
                 f"ms (Python {r.get('python')}, {r.get('machine')})")  # fmt: skip
        return r

    # ------------------------------------------------------------------ status, audit
    def status(self) -> int:
        problems = 0
        name = self.s.audit_s3_bucket or "siaga-audit-<account>-<region>"
        try:
            name = self.bucket_name()
            lock = self.client("s3").get_object_lock_configuration(Bucket=name)
            rule = lock["ObjectLockConfiguration"].get("Rule", {}).get("DefaultRetention", {})
            self.out(f"bucket {name}: Object Lock {rule.get('Mode')} {rule.get('Days')} day(s)")
        except Exception as e:  # noqa: BLE001
            problems += 1
            self.out(f"bucket {name}: not ready ({type(e).__name__})")
        try:
            if not self.ping().get("ok"):
                problems += 1
        except Exception as e:  # noqa: BLE001
            problems += 1
            self.out(f"Lambda {self.s.solver_lambda_name}: not ready ({e})")
        return problems

    def writer(self):
        from agent.audit import LocalAuditWriter, S3AuditWriter

        return S3AuditWriter(LocalAuditWriter(self.s.audit_dir), self.bucket_name(),
                             self.s.audit_s3_prefix, client=self.client("s3"))  # fmt: skip


def write_env(path: Path, values: dict[str, str]) -> None:
    """Replace or append KEY=value lines in place (the file keeps its mode)."""
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    done = set()
    for i, line in enumerate(lines):
        key = line.split("=", 1)[0]
        if key in values and "=" in line and not line.startswith("#"):
            lines[i] = f"{key}={values[key]}"
            done.add(key)
    lines += [f"{k}={v}" for k, v in values.items() if k not in done]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main(argv: list[str]) -> int:
    from botocore.exceptions import BotoCoreError, ClientError

    try:
        return run(argv)
    except (ClientError, BotoCoreError) as e:
        code = e.response["Error"]["Code"] if isinstance(e, ClientError) else type(e).__name__
        print(f"AWS refused: {code}: {str(e)[:300]}", file=sys.stderr)
        print("check the laptop profile: aws sts get-caller-identity --profile <AWS_PROFILE> "
              "(and AWS_REGION in .env); permissions: infra/iam/siaga-laptop-aws.json",
              file=sys.stderr)  # fmt: skip
        return 1


def run(argv: list[str]) -> int:
    export_aws_env()
    s = get_settings()
    setup = Setup(s)
    cmd = argv[0] if argv else "all"
    if cmd == "bucket":
        setup.bucket()
    elif cmd == "solver":
        setup.solver()
    elif cmd == "status":
        return 1 if setup.status() else 0
    elif cmd == "verify-audit" and len(argv) == 2:
        print(json.dumps(setup.writer().verify_remote(argv[1]), indent=2))
    elif cmd == "sync-audit":
        w = setup.writer()
        for case_id in w.case_ids():
            n = w.sync(case_id)
            print(f"{case_id}: {n} entr{'y' if n == 1 else 'ies'} uploaded")
    elif cmd == "all":
        bucket = setup.bucket()
        ok = setup.solver().get("ok")
        env = ROOT / ".env.local"
        values = {"AUDIT_BACKEND": "s3", "AUDIT_S3_BUCKET": bucket, "SOLVER_BACKEND": "lambda"}
        if env.exists():
            write_env(env, values)
            print(f"wrote {', '.join(f'{k}={v}' for k, v in values.items())} to .env.local; "
                  "next: make use-local, restart make dev, make preflight")  # fmt: skip
        else:
            print("add to your .env: " + " ".join(f"{k}={v}" for k, v in values.items()))
        return 0 if ok else 1
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
