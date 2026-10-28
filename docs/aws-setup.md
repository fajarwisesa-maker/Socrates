# AWS in SIAGA: the S3 audit trail and the Lambda solver

Two parts of SIAGA can run on AWS, each behind its own setting, with the local version as
the fallback:

| Part | Setting | What runs on AWS |
| --- | --- | --- |
| **Audit trail** | `AUDIT_BACKEND=s3` | Every audit entry is also stored as its own object in an **S3 bucket with Object Lock**. S3 then refuses to overwrite or delete it until the retention ends. |
| **Solver** | `SOLVER_BACKEND=lambda` | Every risk calculation and plan optimisation (PuLP / CBC) runs as an **AWS Lambda** function, `siaga-solver` |

The language model stays on Bedrock or SAP AI Core. This page covers AWS outside the model.

```
agent ──solve──▶ AWS Lambda "siaga-solver" (Python 3.12, PuLP + CBC)
  │                 └─ if Lambda fails: solve on the laptop, labelled "Lambda unavailable"
  └──audit──▶ local JSONL (working copy, the dashboard reads it)
               └─ background upload ──▶ S3 bucket, Object Lock (governance, 1 day)
                                         audit/<case>/<seq>.json, one object per entry
```

## What you need

- An AWS account and a laptop profile that works: `aws sts get-caller-identity --profile siaga`
  prints your account. Put `AWS_PROFILE=siaga` and `AWS_REGION=ap-southeast-1` in
  `.env.local` (`scripts/fill-env.sh` does this).
- Permissions: the account admin is enough for a hackathon. The minimum is in
  `infra/iam/siaga-laptop-aws.json`: what the setup needs once, and what a running demo needs
  (put and read audit objects, invoke the function).
- Bedrock's model block ("Operation not allowed") does **not** affect S3 or Lambda.

## Once: create both and switch the laptop to them

```bash
make aws-setup      # builds the solver package, creates the bucket and the function,
                    # test-solves on Lambda, writes 3 lines into .env.local
make use-local      # copy .env.local to .env
make preflight      # two new green lines (below)
```

`make aws-setup` is safe to run again; it updates what exists. It prints:

```
created bucket siaga-audit-<account>-ap-southeast-1 with Object Lock
bucket siaga-audit-…: Object Lock GOVERNANCE 1 day(s), public access blocked
created IAM role siaga-solver-lambda
created Lambda siaga-solver
Lambda siaga-solver: CBC solve ok in 9.4 ms (Python 3.12.x, x86_64)
wrote AUDIT_BACKEND=s3, AUDIT_S3_BUCKET=siaga-audit-…, SOLVER_BACKEND=lambda to .env.local
```

What it creates:

| Resource | Details |
| --- | --- |
| S3 bucket `siaga-audit-<account>-<region>` | Object Lock on (it can only be chosen when the bucket is created; versioning comes with it). Default retention **1 day, governance mode** (`AUDIT_RETENTION_DAYS`). All public access blocked. Encrypted at rest by S3's default. |
| IAM role `siaga-solver-lambda` | Lambda may assume it; it can only write its own logs (AWSLambdaBasicExecutionRole) |
| Lambda `siaga-solver` | Python 3.12, x86_64, 1024 MB, 30 s timeout; the code is `build/lambda/solver.zip` (about 8 MB: the solver, PuLP with its Linux CBC binary, pydantic, tzdata) |

**Governance, not compliance mode.** In governance mode an admin with
`s3:BypassGovernanceRetention` can still delete an object. Compliance mode can't be undone by
anyone, including the account root, until the retention ends. That's a poor choice for a
prototype.

## What you see

- **`make preflight`:**
  - `✅ S3 audit trail — siaga-audit-…: Object Lock GOVERNANCE 1 day(s)`
  - `✅ Lambda solver siaga-solver — CBC solve ok on Lambda (… ms; round trip … ms, now warm)`.
    Running preflight shortly before the demo also warms the function.
- **Dashboard, Simulate:** "Calculated by the solver **on AWS Lambda**, not AI".
- **Details drawer (`D`) → This step:** each solver call says `on AWS Lambda`.
- **Drawer → Audit trail:**
  - `S3 Object Lock · 37/37 stored` and the `s3://` location;
  - **Verify in S3** reads the trail back from S3 alone and checks the hash chain. It reports
    "chain intact, same as local · governance lock until …".
- **Drawer → Architecture:** the Solver and Audit boxes name the function and the bucket.
- **Command line:**
  - `make audit-verify CASE=case-…` runs the same check;
  - `make aws-status` shows the bucket and makes one Lambda solve.

## If AWS has a problem during the demo

- **Lambda fails** (no network, throttling, timeout): the same calculation runs on the laptop,
  so the case continues with the same numbers. The label then says "on this laptop (AWS
  Lambda unavailable)", and the drawer shows `on local (Lambda unavailable)`. Set
  `SOLVER_LAMBDA_FALLBACK=0` to make it fail instead.
- **S3 fails:** the case never waits for S3. Uploads retry in the background; the drawer
  shows how many are pending or failed. Run `make audit-sync` later to upload what is missing.
  It never overwrites, so Object Lock is never in the way.
- **To go back to local:** set `AUDIT_BACKEND=local` and `SOLVER_BACKEND=inprocess` in
  `.env.local`, then `make use-local` and restart `make dev`.

## Cost

- The Lambda free tier covers a demo many times over.
- S3 holds about 100 small objects per case.
- Expect well under USD 1 for the whole hackathon.

Locked objects can be deleted once their retention has passed: one day after they were
written, by default.

## Under the hood

| What | Where |
| --- | --- |
| S3 writer: local copy first, ordered background upload, retries, `verify_remote`, `sync` | `agent/audit.py` (`S3AuditWriter`) |
| Lambda client: invoke, fallback, where each call ran | `agent/clients.py` (`LambdaSolver`) |
| Lambda entry point (plus `ping`: a tiny CBC solve) | `services/solver/lambda_handler.py` |
| Package builder (no Docker) | `scripts/package_lambda.py` |
| Setup, status, verify, sync | `scripts/aws_setup.py` |
| Tests | `tests/test_aws_backends.py` (request shapes checked against the AWS API models, the demo over real boto3 and HTTP against `tests/aws_standin.py`); `web/e2e/aws.spec.ts` (`SMOKE_AWS=1 make web-smoke`) |
