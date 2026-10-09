# SIAGA — working notes for Claude Code

SIAGA (Supply Intelligence Agent for Guarding Availability) is a supervised AI agent
for Indonesian FMCG supply chains. Hackathon prototype; Demo Day 31 Oct 2026.
The full brief is the build prompt (sections 0–5); this file records how to run things
and the decisions made. **Update it every phase.**

## Status

| Phase | State |
| --- | --- |
| 0 Setup and check-in | scaffold done; **AWS access blocked** (see Open items) |
| 1–8 | not started |

## How to run

```bash
uv sync                      # Python 3.12 venv + deps (uv installs 3.12 if missing)
make install                 # also installs the pre-commit hook
cp .env.example .env         # then set BEDROCK_MODEL_ID and AWS credentials
make test                    # pytest
make lint / make fmt         # ruff check + ruff format
make aws-check               # STS identity + ACTIVE non-legacy Claude models in AWS_REGION
make aws-probe               # + one forced-tool Converse call per Sonnet model
uv run python scripts/aws_check.py --model-id <id>   # one tiny Converse call
SIAGA_RUN_AWS_TESTS=1 make test                     # include the live Bedrock test
```

`make help` lists all targets; targets for later phases exit with "implemented in Phase N".

## Environment variables

All read through `siaga_common/settings.py` (pydantic-settings, `.env` supported).
See `.env.example` for the full list.

| Var | Default | Meaning |
| --- | --- | --- |
| `LLM_PROVIDER` | `bedrock` | `bedrock` \| `fake` \| `replay` |
| `BEDROCK_MODEL_ID` | **none** | model or inference-profile ID; no default in code by design |
| `AWS_REGION` | `ap-southeast-1` | |
| `REPLAY` | `0` | Phase 6 replay mode |
| `CASE_STORE` / `AUDIT_BACKEND` / `KB_BACKEND` / `POLICY_BACKEND` | local impls | switch to AWS impls in Phase 7 |
| `SAP_MOCK_URL` / `SOLVER_URL` / `CASE_API_URL` | `127.0.0.1:8001/8002/8000` | local services |
| `SQLITE_PATH` / `AUDIT_DIR` | `var/…` | local state (git-ignored) |
| `MAX_TOOL_CALLS` / `MAX_REPLANS` | `20` / `2` | enforced by the state machine |
| `VERIFY_DELAY_SECONDS` | `60` | VERIFY timer |

## Architecture in brief

```
web/ (Next.js) ──poll──> api/ (FastAPI Case API) ──> agent/ state machine
  PERCEIVE → ASSESS → PLAN → SIMULATE → REFLECT → ACT → VERIFY
  every tool call → policy/ (Cedar, cedarpy locally) → tools:
     services/sap_mock (OData-V4-shaped mock S/4HANA)
     services/solver   (PuLP/CBC MIP + stockout risk)
     precedent KB      (BM25 locally)
     audit writer      (hash-chained JSONL locally)
```

Repo layout:

```
agent/          state machine, stages, prompts/, providers/, tools/
api/            Case API
services/       sap_mock/, solver/
policy/         .cedar policies + schema
siaga_common/   settings and shared models
data/           seed/, demo/ (inputs, precedents/), golden/ (replay recording)
scripts/        operational scripts (aws_check.py, …)
web/            Next.js dashboard (Phase 5)
infra/          IaC (Phase 7)
tests/          pytest
```

## Ground rules (short form)

1. The LLM never computes numbers — solver, risk function and mock SAP do.
2. The agent earns the answer via tools; only replay mode uses recorded outputs, labelled.
3. Stage order, 20-tool-call budget and 2-replan cap are enforced in code.
4. Every action tool is checked by the policy engine **and** in-code (defence in depth).
5. Local first; every AWS dependency is behind an interface switched by env var.
6. Verify fast-moving AWS APIs against current docs before coding against them.
7. Ask instead of inventing business numbers.
8. Tests are part of done; the golden numbers in brief §2.2 are asserted.

## Decisions

- **Single uv project at the repo root, not a multi-member uv workspace and not a `siaga/`
  subfolder.** The repo itself is the monorepo. One project keeps `python -m agent.run`
  working from the root and lets Pydantic models be shared without cross-package wiring.
  The solver's Lambda image (Phase 7) will copy only `services/solver` + its own minimal
  requirements, so packaging stays separable.
- **Python 3.12** pinned in `.python-version` and `requires-python = ">=3.12,<3.13"`.
- **PuLP pinned to `>=2.9,<3`.** PuLP 4.0 (current on PyPI) is a breaking Rust-core
  rewrite (`LpVariable(..., cat=...)` no longer exists) and no longer bundles CBC.
  2.9 bundles CBC and has the stable, well-documented API.
- **`cedarpy` installs and works** (4.12.1) — no hand-written Cedar evaluator needed.
- **Pre-commit uses local hooks running the uv-locked ruff** (check + format), so the
  linter version matches `uv.lock` and no hook repo is fetched.
- **Tool-use support is verified empirically.** `ListFoundationModels` does not expose
  tool-use support, so `aws_check.py --probe` makes a forced-`toolChoice` Converse call
  per Sonnet model. Models that are inference-profile-only are invoked via their
  profile ID (prefers `apac.*`).
- Legacy models (Claude Instant, v2, 3.x) are filtered out of the model list.

## Open items

- AWS credentials in the build container are proxy placeholders; STS returns
  `InvalidClientTokenId`. Model list + Converse check still to run.
- `BEDROCK_MODEL_ID` not chosen yet.
