# SIAGA — working notes for Claude Code

SIAGA (Supply Intelligence Agent for Guarding Availability) is a supervised AI agent
for Indonesian FMCG supply chains. Hackathon prototype; Demo Day 31 Oct 2026.
The full brief is the build prompt (sections 0–5); this file records how to run things
and the decisions made. **Update it every phase.**

## Status

| Phase | State |
| --- | --- |
| 0 Setup and check-in | scaffold done; **AWS access blocked** (see Open items) |
| 1 Seed data + mock S/4HANA | done |
| 2 Solver and risk | done |
| 3 Tool layer, policy, audit, case store | done |
| 4 Agent state machine | done with the `fake` LLM; **Bedrock run + PERCEIVE eval blocked on AWS credentials** |
| 5 Case API and dashboard | done |
| 6 Replay mode and demo hardening | done with a **placeholder golden run from the fake LLM**; Bedrock recording + `make rehearse` on Bedrock blocked on AWS |
| 7 AWS deployment | **dropped (owner, 25 Oct)**: no AWS stack. The secrets / SSM / `/health/connections` work stays as the production design |
| 8 | not started |
| v2 step 0 (safety net, access check) | done except the SAP checks (SAP access pending); tag `v1-demo` on `7bccb9a` is local only (this session cannot push tags) |
| v2 step 1 (S/4HANA mock on BTP) | waiting for SAP access |
| v2 step 2 (multi-agent, `ORCHESTRATION=multi`) | done with the `fake` LLM; **3 Bedrock runs blocked** (account returns "Operation not allowed") |
| v2 step 3 (RPT-1.6, `DELAY_MODEL`) | built and tested against a simulated AI Core (SDK response shape) and the offline stand-in; **real RPT call pending**: the SAP variables do not reach this session (`make sap-check`) |
| v2 step 1 (BTP, `SAP_MOCK_ON_BTP`) | package, API key and switch built; deploy files committed in `deploy/btp/` (26 Oct); **not deployed yet** (owner: `cf apps` empty): app `siaga-sap-mock`, steps in docs/btp-deploy.md |
| v2 steps 6 + 5 (UI additions, PII masking) | done: delay chip, Planner prediction details, Architecture tab (Planner + drawer), PII masking (`PII_MASKING=local`) with Planner chip; cumulative cap and Evaluations dropped (owner, 25 Oct); "Approved in SAP Joule" waits for step 4 |
| v2 steps 4, 7 | order agreed 25 Oct: 3 → 1 → 6 + 5 (PII only) → 4 only if 1 and 3 pass by 26 Oct 12:00 WIB → 7 from 27 Oct |
| Laptop live (Demo Day default) | `make use-local`, preflight for mode local, `LLM_PROVIDER=sap_genai` (Claude on SAP AI Core) and `LLM_FALLBACK=sap_genai` built and tested against a simulated AI Core; **live runs, the real v2 golden recording and `make rehearse N=3` wait for credentials** (none of the AWS / AI Core / BTP values work in this session) |
| Env + secrets setup (`SIAGA_env_setup_prompt.md`) | sections 1–6 built and tested locally (leak check clean); **checkpoint**: owner runs `fill-env.sh`, `put-sap-secret.sh`, `make use-aws`, `make preflight`. Preflight lines 4–8 cannot pass until Phase 7 is deployed |
| UI redesign (`SIAGA_ui_redesign_prompt.md`) | step 1 audit (`docs/ui-redesign-audit.md`), backend additions A–G, step 2 visual system + Presenter shell, step 3 stage canvases, step 4 wow moments + pacing, steps 1–6 done (projector check passes; `make rehearse N=10` 10/10 on fake and replay) |

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

Phase 1 (mock S/4HANA):

```bash
make seed [DAY0=2026-10-29]  # load data/seed into var/sap_mock.db (day 0 default: today WIB)
make sap-mock                # mock S/4HANA on http://127.0.0.1:8001 (auto-seeds an empty DB)
make demo-reset              # POST /admin/reset on the running mock, else re-seed SQLite
make demo-inputs             # regenerate data/demo/forwarder_notice.pdf
```

Phase 2 (solver):

```bash
make solver                  # solver API on http://127.0.0.1:8002 (/risk /solve /compare /timing)
make solver-demo [DAY0=…]    # risk + option A, B first solve, B replan from the seed data
```

Phase 3 (tools, policy, audit):

```bash
make policy-demo             # Tier 2 allowed, Tier 3 blocked then approved, Rp 60M escalated
                             # + the case's hash-chained audit trail and its verification
```

Phase 4 (agent):

```bash
make demo-fake               # full case with the scripted LLM, embedded mock SAP, auto-approve
make demo                    # same with the LLM from .env (Bedrock once credentials exist)
make eval-perceive           # PERCEIVE accuracy on the 20-item test set (needs Bedrock)
uv run python -m agent.run --whatsapp data/demo/whatsapp_driver.txt \
    --pdf data/demo/forwarder_notice.pdf [--provider fake|bedrock|replay] [--embedded-sap] \
    [--auto-approve] [--verify-delay N]
```

Without make or bash (native Windows PowerShell/cmd, or anywhere):

```bash
uv sync
cd web && npm ci && cd ..
uv run python scripts/dev.py --fake          # = LLM_PROVIDER=fake make dev
uv run python scripts/dev.py --replay        # = make replay
uv run python scripts/dev.py --embedded-sap  # mock SAP inside the Case API (2 processes)
uv run pytest -q                             # = make test
uv run python scripts/rehearse.py -n 10      # = make rehearse N=10
```

SIAGA v2 (`SIAGA_v2_upgrade_prompt.md`; flags in `docs/v2-flags.md`, all off = v1):

```bash
ORCHESTRATION=multi make dev          # specialist Strands agents (Signal, Impact, Planner, Critic, Executor)
ORCHESTRATION=multi make replay       # on data/golden/multi/ (fake placeholder recording)
ORCHESTRATION=multi make rehearse N=10   # report includes per-agent timings
ORCHESTRATION=multi make web-smoke    # e2e incl. e2e/multi.spec.ts (skips on a v1 API)
make agentcore-check                  # which AgentCore features answer in AWS_REGION (needs AWS creds)
make sap-check                        # AI Core token, deployments, one RPT-1.6 call; cf target; joule status
make btp-package / make sap-latency   # step 1: build/btp for cf push (docs/btp-deploy.md); round trips
PII_MASKING=local make dev            # step 5: mask phones, e-mails, names before any model call
DELAY_MODEL=rpt make dev              # SAP RPT-1.6 delay prediction in Assess (fake = offline stand-in)
DELAY_MODEL=rpt make record-golden    # also records the RPT answers (rpt.jsonl) for replay
```

Laptop modes, secrets and flags (`docs/connections.md`, `docs/demo-day-runbook.md`; nothing
here prints a secret):

```bash
scripts/fill-env.sh               # owner, once: writes .env.local / .env.replay / .env.v1 / .env.aws (hidden input)
make use-local                    # Demo Day: laptop live (live LLM, BTP mock, RPT-1.6, local stores)
make use-replay | use-v1          # fallbacks: recorded run offline / v1 on Bedrock
LLM_PROVIDER=sap_genai make dev   # Claude on SAP AI Core (AICORE_*); LLM_FALLBACK=sap_genai = per-case fallback
AWS_PROFILE=siaga scripts/put-sap-secret.sh   # production design only: SAP values -> siaga/sap
make use-aws                      # production design only (not deployed)
make env-check                    # each variable the mode needs: set / MISSING
make flags-v2 | flags-v1 | flags-show   # SSM /siaga/flags/* (next case picks them up)
make preflight                    # mode aws: one line per connection; local modes: local stack
```

Phase 5 (Case API + dashboard):

```bash
make install                 # once: Python deps, pre-commit, web/ npm ci
make dev                     # mock SAP :8001 + Case API :8000 + dashboard :3000 (Ctrl-C stops all)
                             # LLM per .env; LLM_PROVIDER=fake make dev for the scripted LLM
open http://localhost:3000   # Load demo WhatsApp -> Load forwarder PDF -> Start case -> Approve
make api / make web          # one at a time (EMBEDDED_SAP=1 make api: no separate mock SAP)
make web-check               # tsc + eslint + production build
make web-smoke               # Playwright: full demo + reject path on a production build,
                             # with its own API/ports; screenshots in web/e2e/screenshots/
```

Screenshots of the redesigned dashboard (replay of the fake-LLM golden run): `docs/screenshots/`, shown in README.md.

Dashboard modes (UI redesign): **Presenter** (default, projector) and **Planner** (dense view).
Toggle with `P` or the header switch; `?mode=planner|presenter` overrides (the choice is
remembered per browser). The style tile of the visual system is at `/design`.
Presenter pacing: each stage stays on screen ≥ 5 s (`?dwell=N` seconds, `?auto=1` = no
dwell for tests and rehearse); `Space`/`→` next, `←` back, `H` hold, `R` restart the view
(the agent is not re-run), `L` jump to live; clicking a rail step shows it (and holds).
`D` opens the details drawer (tool calls, options + Critic, audit trail, case facts, reset).
Error-state gallery: `/design/states`. Demo/test knobs: `LLM_SIMULATE_THROTTLE=N|exhaust`
(visible throttling retries on each case's first model call), `MAX_TOOL_CALLS=6` (budget
escalation).

Phase 6 (replay + hardening):

```bash
make record-golden           # record the demo with the LLM from .env -> data/golden/
                             # (accepted only if it reaches Rp 11.4M, approve, RESOLVED)
make replay                  # REPLAY=1 make dev: full stack on the recording, no Bedrock calls
make replay-cli              # the recording through the CLI, instant
make rehearse N=10           # reset -> case -> approve -> VERIFY, N times, via the Case API at
                             # CASE_API_URL (or an in-process one); report in var/rehearse/
make rehearse-fault N=3      # inject a delayed transfer: passes only if VERIFY re-opens the case
make web-smoke-replay        # Playwright on the recording; checks the REPLAY badge
make preflight               # demo-day checklist (LLM / golden / API / SAP day 0 / web / CBC / Cedar)
curl -XPOST localhost:8000/demo/inject -H 'content-type: application/json' \
     -d '{"event":"transfer_delayed"}'   # hidden fault (or po_cancelled); not in the UI
```

`make help` lists all targets; targets for later phases exit with "implemented in Phase N".

## Environment variables

All read through `siaga_common/settings.py` (pydantic-settings, `.env` supported).
See `.env.example` for the full list.

| Var | Default | Meaning |
| --- | --- | --- |
| `LLM_PROVIDER` | `bedrock` | `bedrock` \| `sap_genai` (Claude on SAP AI Core) \| `fake` \| `replay` |
| `LLM_FALLBACK` | unset | `sap_genai`: a case whose first Bedrock call fails (account / throttling) runs on SAP AI Core |
| `SAP_GENAI_MODEL` / `SAP_GENAI_DEPLOYMENT_ID` | `anthropic--claude-4.6-sonnet` / unset | the Generative AI Hub model; its deployment is looked up unless the ID is given |
| `BEDROCK_MODEL_ID` | **none** | model or inference-profile ID; no default in code by design |
| `AWS_REGION` | `ap-southeast-1` | |
| `AWS_PROFILE` / `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` (+ `AWS_SESSION_TOKEN`) / `AWS_BEARER_TOKEN_BEDROCK` | unset | AWS credentials: one of a profile, access keys, or a Bedrock API key. They can sit in `.env`; `export_aws_env()` passes `AWS_*` lines to boto3, and the shell environment wins. A Bedrock API key covers model calls; `make aws-check` needs a profile or access keys (STS) |
| `REPLAY` / `REPLAY_PATH` | `0` / `data/golden/llm.jsonl` | replay recorded LLM responses (no network) |
| `REPLAY_SPEED` | `1.0` | 1.0 = recorded model latency (looks live), 0 = instant |
| `LLM_RECORD_PATH` | unset | record every LLM call of a run (builds the golden run) |
| `LLM_TEMPERATURE` | `0` | sent to Bedrock; dropped automatically if the model rejects it; `off` = never |
| `CASE_STORE` / `AUDIT_BACKEND` / `KB_BACKEND` / `POLICY_BACKEND` | local impls | switch to AWS impls in Phase 7 |
| `EMBEDDED_SAP` | `0` | Case API runs the mock S/4HANA in-process |
| `SIAGA_API_URL` (web) | `http://127.0.0.1:8000` | where the dashboard's `/api/*` rewrite points |
| `SOLVER_BACKEND` | `inprocess` | `inprocess` \| `http` (`SOLVER_URL`) \| `lambda` (Phase 7) |
| `SAP_MOCK_URL` / `SOLVER_URL` / `CASE_API_URL` | `127.0.0.1:8001/8002/8000` | local services |
| `SQLITE_PATH` / `SAP_DB_PATH` / `AUDIT_DIR` | `var/…` | local state (git-ignored) |
| `MAX_TOOL_CALLS` / `MAX_REPLANS` | `20` / `2` | enforced by the state machine |
| `VERIFY_DELAY_SECONDS` | `60` | VERIFY timer |
| `LLM_SIMULATE_THROTTLE` | unset | demo/test aid: `N` visible throttling retries on each case's first model call, or `exhaust` |
| `SIAGA_MODE` | unset | `aws` \| `replay` \| `v1`: the laptop mode (`make use-*`); drives `make preflight` and `make demo-reset` |
| `FLAGS_SOURCE` | `env` | `ssm`: flags from `/siaga/flags/*`, read at the start of every case |
| `SECRETS_SOURCE` / `SAP_SECRET_ID` | `env` / `siaga/sap` | `aws`: SAP values from Secrets Manager, read once per process |
| `CASE_API_KEY` | unset | when set, the Case API requires `X-API-Key`; dashboard proxy, preflight, rehearse send it |

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
siaga_common/   settings, timeline (day offsets <-> WIB/UTC), shared models
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

### Business decisions (agreed with the product owner at the Phase 0–1 check-ins)

1. **Exposure — store both.** `max_exposure` = full penalty / lost margin of every at-risk
   order (UI headline). `expected_exposure` = Σ stockout probability × penalty (used for
   ranking and justification). Demo: both = Rp 340,000,000 (asserted in tests).
2. **`reschedule_customer`** costs that order's full penalty or lost margin, is always
   Tier 3, and applies to whole orders only (no partial reschedules).
3. **Bridge PO rejected.** Keep the already-executed transfer. Replan the *remaining*
   shortfall without V-2002 (counts as one replan); this will likely produce a new Tier 3
   approval for air freight (the Rp 31M charter is a flat price regardless of quantity).
   If no feasible plan remains or replans are exhausted, escalate the whole case to a
   human. Rejection takes an optional free-text reason that the agent reads in the replan.
4. **VERIFY success path:** mock SAP posts the transfer and confirms the PO on creation;
   VERIFY passes if both exist with the expected quantities and projected supply at
   DC-CKR covers the 1,000 cartons by the cutoff. Phase 6 adds a hidden
   `POST /admin/inject` (e.g. `event=transfer_delayed`) that makes VERIFY fail and
   reopens the case — not part of the main demo.
5. **Time anchor.** Day 0 00:00 = midnight Asia/Jakarta (WIB, UTC+7) on the case start
   date. Real timestamps are stored internally (UTC ISO-8601); the UI shows both forms,
   e.g. "Day 2 18:00 · Sat 31 Oct WIB".
6. **Original PO 4500018231: no action.** The case summary carries a Tier 0 note: it will
   arrive late (day 3–4) and leave extra stock at DC-CKR; a planner may want to reverse
   part of the transfer later.

7. **Air charter delivery time** = day 2 12:00 at DC-CKR, stored in the seed quote
   (`A_FreightQuote.YY1_DeliveryDateTime`), not a solver constant.
8. **Bridge PO lead time counts from PO creation (= approval).** At plan time approval is
   assumed immediate. The plan carries an "approve by" time per action (`dispatch_by`
   = deadline − lead time; bridge PO: day 1 18:00). At approval time the agent re-checks
   feasibility against the actual time (`POST /timing`); after the approve-by time the
   plan is infeasible and the agent replans (tested in `test_solver.py`).
9. **AWS credentials are in progress on the owner's side.** Build with the `fake` provider;
   do not block on Bedrock before the end of Phase 4.

### Phase 1 decisions (mock S/4HANA and data)

- **Seed files are one JSON per OData entity set** (`data/seed/A_*.json`) in API field
  shape, so the loader is a straight copy plus time resolution. S/4HANA field names where
  natural; `YY1_*` marks custom extension fields (SAP key-user extensibility convention).
  `null` = the brief gives no value (e.g. V-1001 lead time); nothing is invented except
  identifiers (customer IDs `C-5001/5002`, forwarder `F-3001`, lanes `SMG-JKT`/`BDG-CKR`,
  quote `Q-AIR-0001`).
- **Relative times** (`{"day":1,"time":"10:00"}`) are resolved at seed/reset time against
  day 0 = midnight WIB of the reset date (default today). Reset the demo on the day you
  run it so that day 0 matches the case start date.
- **Extra entity sets beyond the brief:** `A_Product`, `A_Plant`, `A_TransportLane`
  (truck rate/capacity/transit/reversibility, Pantura vs non-Pantura corridor) and
  `A_FreightQuote` (the air charter quote). Without them the agent would have no tool
  source for those §2.1 numbers. The forwarder is an `A_Supplier` with role `FORWARDER`.
- `A_SalesOrder` is flat (header + one material line) instead of header/item — simpler
  for the agent, and every demo order has one line.
- **Storage:** `SapStore` interface; SQLite impl uses a single generic table
  `(entity_set, key) -> JSON`, which maps 1:1 to a single-table DynamoDB design (Phase 7).
- **OData support:** `value` envelope + `@odata.context`, key lookup incl. composite keys
  (`A_MaterialStock(Material='MG-2L',Plant='DC-CKR')`), `$filter` (eq/ne/gt/ge/lt/le,
  and/or/not, parentheses, contains/startswith/endswith, unquoted ISO datetimes),
  `$select`, `$top`, `$orderby` (nulls lowest). Errors are `{"error":{code,message}}`.
- **Mock SAP does bookkeeping only.** `POST /StockTransfer` checks lane, truck capacity
  and on-hand, moves stock (source on-hand ↓, destination in-transit ↑), status
  `IN_TRANSIT`, ETA = now + lane transit hours, cost = trucks × lane rate. It does **not**
  enforce safety stock — that is the Critic's business rule (tested).
  `POST /A_PurchaseOrder` (deep insert `to_PurchaseOrderItem`) assigns numbers from
  4500018232, confirms immediately up to the supplier's remaining capacity
  (`PARTIALLY_CONFIRMED` beyond it), ETA = creation + supplier lead time, premium =
  premium/carton × confirmed qty. Both accept an `IdempotencyKey` for safe retries.
  Tier/approval checks live in the tool layer (Phase 3), not here.
- **Forwarder PDF has no calendar date** so it never contradicts the demo timeline;
  regenerate with `make demo-inputs`.
- **PERCEIVE test set** vocabulary (causes, lanes `SMG-JKT`/`BDG-CKR`/`SBY-JKT`/`TPR-CKR`/
  `MRK-BKS`) and scoring rules are in `data/demo/PERCEIVE_TESTSET.md`.
- Precedents P-001 (Pantura flood, donor DC taken below safety stock → secondary miss),
  P-002 (Cikampek toll closure), P-003 (Priok port strike) resemble the demo case.
- **Starlette:** the TestClient deprecation warning about httpx is filtered in
  pytest config.

### Phase 2 decisions (solver and risk)

- **Solver is a pure function of its inputs** (`services/solver/models.py`); it never calls
  SAP. `agent/tools/sap_to_solver.py` maps OData rows + the structured disruption to
  solver inputs; tests and `make solver-demo` build inputs through the mock SAP API the
  same way the agent will.
- **Risk** (`risk.py`): delay distribution (`none` / `fixed` / `uniform`) vs each order's
  cutoff; P(late) = P(D > cutoff − ETA). Scenarios of inbound shipments on time / late are
  enumerated (independent delays); in each, stock available by the cutoff (on hand −
  safety stock + on-time inbound) is allocated by cutoff, then penalty desc; an order is
  missed unless filled in full (OTIF). `shortfall` assumes every at-risk inbound misses;
  `deadline` = earliest cutoff with a shortfall. Both exposure figures are returned.
- **MIP** (`mip.py`, PuLP/CBC, single thread, 10 s limit): integer trucks and cartons,
  binary air (flat price covers up to the shortfall) and binary whole-order reschedule.
  Options that cannot arrive by the deadline are excluded *before* solving and listed in
  `excluded` with the reason. Constraints are typed: `safety_stock` (Critic) and
  `exclude_supplier` (rejected bridge PO). A 1e-4 IDR/carton ε breaks ties toward moving
  less stock; reported costs are recomputed from the solution, never from the objective.
  Infeasible results carry a deterministic `infeasible_reason` (max coverable vs required).
- `compare` gives saving vs a baseline and exposure avoided (max exposure minus penalties
  accepted via reschedule). `timing` re-checks an action at the actual approval time.
- One dispatch table (`operations.py`) serves FastAPI and the Lambda handler; the handler
  accepts a direct `{"operation", "payload"}` invoke or an API Gateway proxy event.
  How AgentCore Gateway invokes Lambda targets is to be verified in Phase 7.
- Single shared deadline per solve (all demo orders share day 2 18:00); multi-cutoff
  plans are out of scope for the prototype.
- `siaga_common/money.py`: `format_idr(11400000) == "Rp 11.400.000"`.

### Phase 3 decisions (tool layer, policy, audit, case store)

- **Call path** (`agent/tools/base.py` `ToolRegistry.invoke`): budget check → argument
  validation → tier assessment in code → approval lookup → Cedar `authorize()` → tool
  `run()` (which re-checks its tier in code) → audit. Denials, errors, bad arguments and
  budget exhaustion return a structured `ToolCallResult`; nothing raises into the agent.
- **Tier mapping per tool:** each tool declares `policy_context(args)` — facts computed
  from its arguments and SAP data (`observe_only`, `draft_only`, `internal`, `reversible`,
  `external_commitment`, `spot_air`, `sla_change`, `amount_idr`). The LLM never supplies
  these. `classify()` maps facts → tier 0–3 (brief §2.3) for the in-code check; Cedar
  decides independently from the same facts. An exhaustive test (768 combinations ×
  3 amounts) proves the two agree.
- **Cedar** (`policy/siaga.cedar`): four permits (tier0-observe, tier1-draft,
  tier2-execute, tier3-approved) and four Tier 3 forbids (amount ≥ Rp 50M, spot air,
  SLA change, external commitment) each `unless { context.has_approval }`; default deny
  for anything else. Every policy has an `@id`; decisions report those ids. Policies are
  validated against `policy/siaga.cedarschema` + an action list generated from the
  registry. Principal `Agent::"siaga"`, resource `Case::"<id>"`, action = tool name.
  How AgentCore Policy names principals/actions is to be verified in Phase 7.
- **Approvals bind to exact arguments**: an approval carries tool + canonical-JSON hash of
  the arguments; `has_approval` is true only for an APPROVED request with the same hash.
  The approval ID is the SAP idempotency key, so a retried Tier 3 call never duplicates
  a PO / freight order.
- **Defence in depth:** `Tool.guard()` at the top of every action tool recomputes the tier
  and looks up the approval itself; tested with a misconfigured allow-all policy engine
  and with direct `run()` calls.
- **Budget:** the registry refuses the call that would exceed `MAX_TOOL_CALLS`
  (`budget_exceeded`, not counted). Every attempted call counts, including denials.
- **Tools** (11): Tier 0 `find_inbound_purchase_orders`, `assess_impact` (SAP reads +
  risk function), `search_precedents`, `simulate_option` (solver, using the case's risk;
  requirement reduced by supply already executed in the case), `get_action_status`,
  `request_human_approval` (alert only; refuses actions that are not Tier 3);
  Tier 1 `draft_rfq`; actions `execute_stock_transfer` (2 or 3),
  `create_purchase_order`, `book_spot_air`, `reschedule_customer_order` (always 3).
  Action tools and `request_human_approval` are not offered to the LLM
  (`llm_visible=False`): ACT executes the chosen solver plan in code. `Tool.spec()` gives
  the Bedrock Converse `toolSpec` (later the Gateway tool definition).
- **Mock SAP additions:** `POST /FreightOrder` (book the air quote; quote → BOOKED, stock
  in transit) and `POST /SalesOrderReschedule` (SO → RESCHEDULED), so every Tier 3
  action has something real to execute.
- **Audit** (`agent/audit.py`): JSONL per case, `hash = sha256(canonical entry without
  hash)`, chained by `prev_hash` from a zero genesis; `verify()` reports the first broken
  entry. Kinds: `policy_decision`, `tool_call`, `approval` (stage transitions come with
  the state machine in Phase 4).
- **Case store** (`agent/case_store.py`): `CaseRecord` working memory, events with
  per-case `seq` for `?after=` polling, approvals. SQLite now; DynamoDB in Phase 7.
- **KB:** local BM25 over title (×2), tags (×2) and body; the demo query ranks P-001 first.
- **CBC stall fix:** `PULP_CBC_CMD(threads=1, timeLimit=…)` stalled for the full time limit
  in ~1 of 20 solves. `threads` is no longer passed (200/200 solves ≤ 14 ms; regression
  test added), and a time-limited, unproven solution is reported as not optimal.
- `make demo-reset` also clears the local case store.

### Phase 4 decisions (agent state machine)

- **`agent/machine.py`** runs PERCEIVE → ASSESS → PLAN → SIMULATE → REFLECT → (replan →
  PLAN …) → ACT → VERIFY. Legal transitions are a table; `_enter()` refuses anything else.
  Every stage writes `started`/`completed` events (with elapsed time), every tool and LLM
  call writes an event, and stage transitions and LLM calls are audited too.
- **What the LLM does:** PERCEIVE (structured disruption via `report_disruption`),
  ASSESS (chooses `find_inbound_purchase_orders` / `assess_impact` calls), PLAN
  (`search_precedents`, then `propose_candidates` — strategies only, no numbers),
  REFLECT (`write_explanation` of results it is given, amounts pre-formatted).
  **What code does:** SIMULATE (one solver call per candidate with the active
  constraints), the Critic rules, option selection, ACT, VERIFY, approvals, replans.
- **Code guards on the LLM:** structured outputs are validated with Pydantic; an invalid
  or missing tool call gets the validation error back, plus one nudge; 5 turns max, then
  escalate. ASSESS rejects an `assess_impact` call whose delay differs from PERCEIVE's;
  if the model never completes ASSESS, a deterministic fallback makes the same two calls
  (visible as an event). Strategies the planner ruled out are stripped from candidates.
- **Critic** (`agent/critic.py`): feasible, safety_stock, incoterm (DDP only),
  supplier_capacity, cutoff_met, tier_mapping. **Selection:** cheapest feasible option of
  the round; if it violates a rule that a solver constraint fixes (safety_stock →
  `safety_stock`, incoterm → `exclude_supplier`), add the constraint and replan; if the
  replan cap is reached or nothing can fix it, escalate. Options are named
  `<letter><round>`: A1/B1 first round, A2/B2 after the replan.
- **Comparison baseline** = the latest clean spot-air-only option (else the most
  expensive clean option); saving and exposure avoided come from the solver's `compare`.
- **ACT:** each chosen action is mapped to a tool call in code (`agent/actions.py`); its
  tier is computed dry; Tier ≤ 2 executes through the registry, Tier 3 raises an approval
  with a card (what, why, cost, alternatives, if rejected, approve by). Tier 0 note added
  for each delayed PO (decision 6).
- **Approvals:** approve → timing re-check at the actual time (solver `/timing`) → execute
  or mark EXPIRED and replan; reject → keep executed actions, `exclude_supplier` (bridge)
  or rule out the strategy (air / reschedule), store the reason for the PLAN prompt,
  replan the remaining shortfall. Replans from rejections count toward the cap.
- **VERIFY:** reads SAP status of every executed action; passes if quantities, statuses
  and ETAs match and usable stock + secured supply ≥ demand; otherwise re-opens the case.
  `verify_due_at` = now + `VERIFY_DELAY_SECONDS`; the CLI sleeps, the Case API (Phase 5)
  will schedule it.
- **Escalations** (case → ESCALATED with a reason): budget exhausted, replan cap, no
  feasible option, invalid LLM output, LLM unavailable, unexpected internal error.
- **Providers** (`agent/providers/`): `bedrock` (boto3 Converse; `toolChoice` always
  `auto` because current Claude models reject forced tool choice; `temperature` 0 sent
  and auto-dropped if rejected; adaptive retries), `fake` (scripts in
  `providers/scripts.py` that read the request like the model would — used by tests and
  `make demo-fake`), `replay` + `RecordingProvider` (JSONL per purpose; Phase 6 golden run).
- **Prompts** are `agent/prompts/<stage>.v<N>.md`; the version used is recorded with
  every LLM call in the audit trail.
- **PERCEIVE eval** (`agent/perceive_eval.py`, `make eval-perceive`) reuses the
  production PERCEIVE path and the scoring rules of `data/demo/PERCEIVE_TESTSET.md`.
- `scripts/aws_check.py --probe` now uses `toolChoice` auto and reports whether each model
  accepts temperature 0.

### Phase 5 decisions (Case API and dashboard)

- **Case API** (`api/app.py`): the endpoints of brief §Phase 5, plus `GET /cases`,
  `GET /cases/{id}/audit` (entries + chain verification), `GET /config` (provider and
  replay flag for UI badges) and `GET /demo/inputs/{whatsapp,pdf}` (preload buttons).
  `POST /cases` and approval decisions return 202; the agent runs in a thread pool with
  a lock per case; a scheduler thread fires VERIFY when `verify_due_at` passes.
  Approval preconditions are checked synchronously (409 if the case is not waiting or
  the approval is not pending). `POST /demo/reset` resets SAP and clears cases.
- **SAP for the API:** HTTP to `SAP_MOCK_URL` by default (`make dev` runs the mock on
  :8001); `EMBEDDED_SAP=1` runs it in-process (`services/sap_mock/embedded.py`).
- **Dashboard** (`web/`, Next.js 16.4 App Router + TS + Tailwind 4; 16.4.3 since 25 Oct): one page, a server
  `page.tsx` rendering a client `Dashboard` that polls `/cases/{id}` and
  `/events?after=` every second and stops once the case is finished. Browser traffic goes
  to `/api/*`, rewritten to the Case API (`SIAGA_API_URL`), so no CORS is needed.
  Panels: signal inbox (with demo preload), live 7-stage timeline (status, elapsed time,
  expandable details + event log), impact, options comparison (A vs B1 rejected vs B2
  replan; cost, latest ETA, max tier, outcome), approval cards (approve / reject with
  reason; SAP number after approval), agent explanation, audit trail (hash-chain status),
  demo clock (signal → verified, "~3 days → minutes"). It reloads into the latest case.
- **Formatting:** `web/lib/format.ts` mirrors `money.py` / `timeline.py`
  (`Rp 11.400.000`, `Day 2 18:00 · Sat 31 Oct WIB`). UI text is English; signal text and
  evidence quotes keep the original Bahasa (`lang="id"`, italic).
- **Next 16 specifics** (read from `node_modules/next/dist/docs` as `web/AGENTS.md` asks):
  Cache Components is on, so client components must not read `Date.now()` during render
  (clocks start in an effect); only one `next dev` per directory, so the smoke test builds
  into its own `distDir` (`SIAGA_DIST_DIR=.next-smoke`) and runs `next start`;
  `allowedDevOrigins: ["127.0.0.1"]`; dev indicator off; system fonts only (no Google
  Fonts download, the demo laptop may be offline).
- **Comparison baseline** skips options with the same strategies as the chosen one (so a
  replan to air after a rejected bridge PO shows no "saving vs air").
- **Playwright** `@playwright/test` is pinned to 1.56.1 to match the preinstalled
  Chromium; on a laptop run `npx playwright install chromium` once.

### Phase 6 decisions (replay and demo hardening)

- **Golden run** (`scripts/record_golden.py`, `make record-golden`): one full demo case is
  run in-process with the configured LLM wrapped in `RecordingProvider`; the recording is
  written to `data/golden/llm.jsonl` (+ `meta.json`: provider, model, prompt versions,
  per-call latency/usage, stage timings, outcome) **only if** the run reaches the golden
  outcome (one replan, Rp 11.400.000, transfer executed, bridge approved, RESOLVED).
  **The committed recording is a placeholder from the fake LLM** (`meta.json` says
  `"provider": "fake"`, the UI badge says "(fake)", `make preflight` warns); re-record
  with Bedrock once credentials exist.
- **Replay** (`agent/providers/replay.py`): responses are served in recorded order per
  purpose **per case** (requests now carry `case_id`, never sent to the model), so one
  API process can replay the demo any number of times. No AWS client is ever built
  (tested with boto3 patched to fail, and rehearsed with credentials removed and the
  HTTPS proxy pointed at a dead port). Request digests are recorded for diagnostics only:
  display dates move with day 0, so they are not enforced. Leaving the recorded path
  (e.g. rejecting the bridge PO) escalates with "the case left the golden path".
  `REPLAY_SPEED=1` replays at the recorded model latency so the stage timeline looks live.
  A test replays the committed recording end to end, so a change to prompts or stage
  flow that breaks it fails CI until `make record-golden` is re-run.
- **Fault injection (decision 4):** mock SAP `POST /admin/inject`
  (`transfer_delayed`: status DELAYED and ETA +48 h; `po_cancelled`: PO
  CANCELLED_BY_SUPPLIER; latest document unless `ref` given) and a hidden Case API
  passthrough `POST /demo/inject` (not in the OpenAPI schema or the UI). VERIFY then fails
  and the case becomes **`REOPENED`** (a new status: `OPEN` stays "new, not yet picked up",
  which `make rehearse` caught being ambiguous). The dashboard shows a red banner.
- **`make rehearse`** (`scripts/rehearse.py`) drives the Case API over HTTP (or an
  in-process one with an embedded mock SAP if none answers) and asserts at every step:
  exposure 340M (max and expected), shortfall 900, P(stockout) 100%, one replan, an
  8.1M option rejected for safety stock, a 31M air option, chosen 11.4M, saving 19.6M,
  Tier 2 transfer 3.9M executed, Tier 3 bridge 7.5M pending with approve-by day 1 18:00,
  ≤ 20 tool calls; then PO created, RESOLVED, coverage verified, audit chain intact.
  Reports pass rate, time to approval card, approve→PO, signal→verified and per-stage
  mean/max to `var/rehearse/report-*.json`. `--inject` flips the expectation to REOPENED
  and needs VERIFY_DELAY_SECONDS ≥ 3 so the fault lands first.
- **VERIFY on the compressed timer:** `VERIFY_DELAY_SECONDS` (60 by default) with a live
  "Verification in N s — re-reading SAP" countdown on the VERIFY row.
- **Pre-flight** (`make preflight`): LLM (Bedrock ping with tool call, or golden present
  and not fake), Case API and its provider, mock SAP reachable and day 0 = today, dashboard
  up, CBC solve time, Cedar policies validate. Red = blocker, amber = read me.
- **Demo-day fallback:** if Bedrock misbehaves on stage, stop `make dev` and start
  `make replay` (same UI, REPLAY badge visible); nothing else changes.
- `web_smoke.sh` waits until its ports are free on exit, so smoke runs can go back to back;
  `SMOKE_LLM=replay` runs the golden-path test on the recording.

### UI redesign — locked decisions (agreed at the step 1 check-in)

Audit and field gap list: `docs/ui-redesign-audit.md`. The backend additions A–G are
additive (no field removed).

- **A. Evidence spans are located by code, never by the model.** `report_disruption`
  returns `evidence: [{quote, source: whatsapp|pdf, field}]`. Code finds each quote in that
  signal's text (whitespace- and case-normalised, otherwise exact) and stores `start`/`end`
  offsets. A quote that cannot be found is dropped and logged, never guessed. The UI
  highlights only spans that passed this check. `evidence_quotes` stays, derived from it.
- **Confidence is computed in code from the located evidence** (no extra LLM call, same
  result every run): one informal source → **Medium**; a second source that agrees on
  **lane and delay** (the forwarder PDF) → **High**. Agreement is counted per field from
  each evidence item's `source` and `field`. The UI shows labels (Medium → High), never
  percentages. The model's own numeric confidence is kept in the audit trail only.
- **C.** `assess_impact` also returns display labels (plant names, supplier name + city,
  lane from/to/corridor) read from SAP; no extra tool call; the UI never hard-codes names.
- **D. Precedent period** (`period: 2025-02`) is carried in search hits and in the PLAN
  `completed` event (`precedents: [{id, title, period, synthetic}]`). Planner mode and the
  details drawer label them **"synthetic precedent"**; Presenter mode may show just
  "Similar: Pantura flood, Feb 2025".
- **E. Critic sentence from a code template** filled with the solver's numbers
  (e.g. "Bandung DC would drop to 50 cartons, below its safety stock of 400"), plus the
  structured `facts`. The LLM may write the longer explanation but never produces the
  numbers in that sentence.
- **F. Net protected** = `exposure_avoided − chosen_cost`, computed by the solver's
  `compare` (`net_protected`, with a display form in `summary`). The impact meter shows it
  as **"Protected (net)"**; the final line keeps the gross wording:
  "Rp 340 jt protected for Rp 11,4 jt". The UI does no money arithmetic.
- **G. Throttling retries are visible.** The Bedrock provider retries throttling itself and
  writes an `llm` event with status `retry`; the UI shows a small neutral "Retrying…" note
  on the current stage, and error styling only when retries run out (escalation).

- **Step 2 (visual system and shell).**
  - Tokens live in `web/app/globals.css`: off-white canvas, white cards, teal brand
    `#0F766E`, status colours used only for status. Each status has a base hue (fills,
    icons, numbers ≥ 24px) and an `-ink` shade (≥ 4.5:1) for text. The style tile with
    measured contrast is at `/design`.
  - Font: Geist via `next/font/local` (the `geist` package). The font is bundled, so the
    demo laptop needs no font download. Figures use tabular-nums.
  - Presenter mode scales the root font size with the viewport
    (`html.presenter { font-size: min(1.25vw, 2.2222vh) }`). 1rem = 16px at 1280×720 and
    24px at 1920×1080, so both have the same layout.
  - Presenter type sizes:
    - content text ≥ `text-xl` (20px at 1280×720);
    - stage titles 2.5rem;
    - hero number 4rem;
    - only chrome (key hints, the mode switch, badges) is smaller.
  - shadcn/ui primitives (`components/ui/`) are written by hand in the shadcn shape, because
    the shadcn registry is blocked by the network policy. They use `radix-ui`, `cva`,
    `clsx` and `tailwind-merge`.
  - UI dependencies are pinned exactly, to releases at least two weeks old: `motion`,
    `lucide-react`, `radix-ui`, `class-variance-authority`, `clsx`, `tailwind-merge`,
    `geist`. No other UI dependency.
  - State: `lib/useCase.ts` (polling, shared by both modes), `lib/stages.ts` (stage state;
    VERIFY now shows `failed` on a re-opened case), `lib/mode.ts` (mode as a
    `useSyncExternalStore`, so there is no hydration mismatch).
  - The Planner e2e tests open `/?mode=planner`. A Presenter e2e test checks the rail,
    the meter (Rp 340 jt / 11,4 jt / 328,6 jt) and the `P` toggle.

- **Step 3 (stage canvases).**
  - `components/presenter/canvases/*`: one canvas per stage, built only from the case
    record and events.
    - Perceive: WhatsApp bubble and PDF phrases with the code-located highlights, the
      disruption card with source icons per field, and confidence "Medium → High".
    - Assess: lane schematic, the stuck PO, the orders at risk.
    - Plan: strategy chips and cited precedents.
    - Simulate: priced option cards, labelled "calculated by the solver, not AI".
    - Reflect: rejected card with the Critic's template sentence, next to the chosen card.
    - Act: executed card next to the approval card (Approve / Reject with a reason).
    - Verify: lane after mitigation, coverage, the final line, and the Tier 0 note.
  - Words come from `lib/present.ts`; names come from SAP labels; numbers from the backend.
  - **View cursor:** clicking a rail step shows that stage; clicking it again steps back
    through its rounds (e.g. Reflect 2 → 1). "Back to live" follows the agent again. Step 4
    builds the dwell queue on this.
  - **Case cost:** the solver's `compare` takes `already_spent` (actions executed earlier
    in the case) and returns `case_cost`. `net_protected` = exposure avoided − case cost.
    After a rejected bridge PO the meter shows Rp 34,9 jt (air Rp 31 jt + the Rp 3,9 jt
    transfer already executed), not Rp 31 jt.
  - The confidence basis carries `progression` (the grade after each signal), so the UI
    never re-implements the rule.
  - The meter shows no plan figures on an escalated case, and a muted "not confirmed"
    figure on a re-opened one.
  - The replay smoke run now also runs the Presenter e2e test. That test covers Perceive
    highlights, the Critic sentence, approve-by, one-click approve and the final line.
  - Dev note: kill a stale `next dev` by PID (`ps aux | grep next-server`). `lsof -i:3000`
    can miss it, and a stale server serves an outdated Tailwind scan.

- **Step 4 (wow moments and pacing).**
  - **Pacing** (`lib/pacing.ts`): the case is a list of *steps*. A step is a run of
    consecutive events of one stage, e.g. Plan round 2.
    - The view shows one step and moves on after the dwell (default 5 s; at least 3 s on
      Perceive and 3.5 s on Reflect, the longest animations).
    - The rail and the impact meter use only the events up to the shown step, so the
      meter never runs ahead of the narration. The clock stays real time.
    - A case started here plays from its first step; a case loaded on page open shows its
      latest step.
    - An approval restarts the dwell, so the card's amber → green change stays on screen.
  - **Wow moments** (`motion`):
    1. Perceive: the slang phrases light up one after another. Lines then draw from each
       WhatsApp phrase to the field it produced (`EvidenceLinks` measures the DOM). The
       PDF phrases arrive, then the confidence moves from Medium to High.
    2. Reflect: the REJECTED stamp lands on the cheapest card, its price is struck
       through, and the Critic's sentence appears. The rail's loop arrow draws itself. On
       the replan round the chosen card slides in and the meter counts up.
    3. Act: one card goes amber → green in place. The button reads "Creating PO in SAP…",
       then the PO number pops in with a check.
    4. Verify: the header clock stops with one pulse, then the final line lands in two
       beats: "Rp 340 jt protected for Rp 11,4 jt", then "3 days → 0m 52s". The time is
       real: Start case → verified.
  - Also animated: each step slides in, and on Assess the order cards turn red while the
    stockout probability counts up to 100%.
  - The Perceive headline no longer uses SAP names ("Flood · 48–72 h delay"). It no
    longer changes when Assess finishes, and it fits on one line.
  - **Reduced motion:** `MotionConfig reducedMotion="user"`, and each animation checks
    `useReducedMotion()` and shows its end state at once (no slide, stamp or count-up).
    There is an e2e test for it.
  - e2e:
    - the existing Presenter test runs with `auto=1`;
    - a new pacing test checks:
      - the view and the meter don't run ahead of the narration;
      - Space, → and H move or hold the view;
      - clicking the rail steps back through rounds;
      - R restarts the view; L jumps to live;
    - both new Presenter tests also run in the replay smoke.

- **Step 5 (Planner mode, details drawer, error states).**
  - **Details drawer** (`D`, `components/presenter/DetailsDrawer.tsx`; a Radix Dialog
    used as a right-side sheet, with Radix Tabs). Tabs:
    - This step: events, tool calls with tier, arguments, and raw JSON on demand.
    - Options & Critic: the solver table and every check with its template sentence and
      rule id.
    - Audit trail: hash-chain status and entries.
    - Case: tool / model call counters against the configured limits, the model provider
      or replay source, precedents labelled "synthetic precedent", the model-written
      explanation (labelled), Tier 0 notes, keys, Reset demo.
    - Raw JSON appears only here, never on the canvas.
  - **Planner mode** uses the visual system: design-token colours, Geist, a light clock
    card, and a 2-column layout (main column: timeline, options, audit; sidebar:
    approvals, impact, explanation).
    - All stages are expanded.
    - Perceive lists each located evidence quote with its source and field, plus any
      dropped quotes, and confidence Medium → High.
    - Plan lists the cited precedents labelled "synthetic precedent".
    - Reflect shows the Critic's template sentences with the rule id.
    - The options table uses fixed column widths, plain plan lines and the Critic reason.
    - Impact adds Plan cost (case cost) and Protected (net).
    - Approval cards hide an empty approve-by or alternatives, show the rejection
      reason, and use the dark green Approve button (white on `#16A34A` fails contrast).
    - The timeline counter uses the configured limits.
    - The signal inbox moves below the case panels once a case exists.
  - **Error states** (`lib/notices.ts` + `components/StateNotices.tsx`, shared by
    Presenter, Planner and the drawer):
    - neutral grey "Retrying the model call…" while a retry is in progress;
    - a "retried N times" footnote (Planner only);
    - red "Blocked by policy: <tool>" with the backend's denial message;
    - escalations with a plain title (model stayed busy / budget used up / replan limit /
      no feasible plan), the reason, and "everything done so far is kept and in the
      audit trail". One red notice per hand-over.
    - The gallery at `/design/states` renders every state from fixture events through
      the same `notices()`. Tool denial cannot happen on the demo path (ACT routes Tier 3
      to approval), so it is shown there.
  - **`LLM_SIMULATE_THROTTLE`** (`agent/providers/throttle.py`): wraps any provider. Each
    case's first PERCEIVE call goes through N reported retries (1.5 s each), or runs out
    after 6 attempts and raises `LLMError`. Tested; off by default.
  - e2e: drawer test, gallery test; both also in the replay smoke.

- **Step 6 (projector check).**
  - `web/e2e/projector.spec.ts` simulates a washed-out projector by reducing contrast 30%
    (each sRGB channel c → 0.5 + 0.7·(c − 0.5)). It walks every Presenter step of a real
    run at 1280×720, plus the start screen, the approved Act card and the verified end.
    - For each visible text, including SVG lane labels, it measures the colours the
      browser actually paints: stacked backgrounds and opacity are accounted for.
    - It fails if any text falls below 4.5:1, or below 3:1 for large text (≥ 24px, or
      ≥ 18.66px bold).
    - It runs in both smoke suites.
  - **Colour tokens darkened to pass after washout:**
    - `ink-2` #475569 → #334155;
    - `brand-ink` #0B5D57 → #0A4F4A;
    - `risk-ink` #B91C1C → #991B1B;
    - `human-ink` #92400E → #78350F;
    - `ok-ink` #166534 → #14532D;
    - the fills, so white icons on them keep ≥ 3:1: `ok` #16A34A → #15803D,
      `human` #D97706 → #B45309.
    - Brand teal #0F766E and risk red #DC2626 are unchanged.
  - The check found intentional dims that were made with opacity: the rejected card's
    label and price (0.5–0.55) and the old route on Verify (0.45). They now use the solid
    `ink-2` colour; only lines and markers keep opacity. The "Chosen" pill uses
    `brand-ink`.
  - The Presenter header stays on one line at 1280: smaller gaps, the next-step hint
    reads "Next: Plan (2)", and the details button is an icon plus `D`.
  - Playwright runs with `workers: 1`: every test resets the one shared demo API, so a
    second spec file running in parallel collided with the first.
  - **Dev note:** Turbopack keeps a persistent dev cache in `web/.next/dev` that can
    serve stale CSS even after a restart. If tokens or new Tailwind classes don't show
    up, stop `next dev`, `rm -rf web/.next/dev` and start it again.
  - Results: pytest 158 passed (1 live-Bedrock skipped); web smoke 8/8 (fake) and 7/7
    (replay); `make rehearse N=10` 10/10 on the fake LLM and 10/10 on replay;
    `make rehearse-fault N=3` 3/3.

### Native Windows support

- **All text file I/O passes `encoding="utf-8"`.** Windows Python defaults to cp1252, which
  garbled `§ – →` in policies, prompts and the recording, and made PERCEIVE drop the
  forwarder's "48–72 hours" quote. The suite passes with an ASCII default encoding
  (`PYTHONCOERCECLOCALE=0 LC_ALL=C PYTHONUTF8=0 uv run pytest`); the only remaining
  `EncodingWarning` is PuLP reading its own ASCII config.
- **`scripts/dev.py`** replaces `make dev` / `make replay` where there is no bash: it
  starts the three services in their own process groups and stops all of them on Ctrl-C,
  SIGTERM or when one exits (`taskkill /T` on Windows, `killpg` elsewhere).
- **`.gitattributes`** keeps LF in a Windows checkout.
- Still bash-only: `make` itself and `scripts/web_smoke.sh` (Playwright smoke). On Windows,
  run Playwright directly in `web/` against a running stack, or use Git Bash.

### SIAGA v2 step 0 decisions

- `v1-demo` = commit `7bccb9a` (rehearse N=3: 3/3 fake, 3/3 replay). The tag exists in the
  build container only: the session's git proxy refuses tag pushes. Push it from a clone
  (`git tag v1-demo 7bccb9a && git push origin v1-demo`) if a remote tag is wanted.
- `docs/v2-flags.md` lists every flag; `.env.example` has the SAP variable names, no values.
- AgentCore availability in ap-southeast-1 could not be read from AWS docs (the docs host is
  blocked by this environment's network policy). From AWS announcements found by search:
  Policy is GA in Singapore; temporal policies (Dogwood) list Singapore as available;
  Gateway is likely; Runtime is listed by trackers; Evaluations is unclear (sources
  conflict). The installed botocore has the Policy (incl. Dogwood/temporal statements),
  Gateway rate-limit and Evaluations APIs. `make agentcore-check` confirms per account.

### SIAGA v2 step 2 decisions (multi-agent orchestration, `ORCHESTRATION=multi`)

- **Strands Agents `strands-agents==1.58.1`** (6 Oct; pinned two weeks back like the UI
  deps). Read from the installed package, not from memory: `Model.stream`,
  `PythonAgentTool`, `request_state["stop_event_loop"]`, `limits={"turns": N}`,
  `SequentialToolExecutor`, `retry_strategy=None`.
- **`agent/multi/orchestrator.py`**: `MultiAgentOrchestrator` subclasses the v1 `Agent`
  and overrides only the model-facing hooks (`_perceive_model`, `_assess_model`,
  `_plan_model`, `_solve`, `_review_options`, `_explain_model`, `_card`). Stage order,
  budget, replan cap, evidence location, confidence, selection, approvals, ACT, VERIFY
  and escalations are the v1 code. `agent/factory.make_agent` picks the class.
- **Every model call still goes through `Agent._llm`.** `agent/multi/model.py`
  (`OrchestratedModel`) is a Strands model provider that calls it, so fake / replay /
  recording / Bedrock, retry events, audit and the LLM counter are unchanged. Strands runs
  each specialist's loop (tool choice, tool execution, conversation).
- **Specialists** (`agent/multi/specialists.py`) with prompts `agent/prompts/<key>_agent.v1.md`:
  - Signal (PERCEIVE): `extract_pdf_text`. The PDF is shown as an attachment it opens itself.
    Evidence items carry `gloss_en` (translation only); code still locates every quote.
  - Impact (ASSESS): `find_open_pos`, `get_sales_orders`, `get_stock`, `compute_risk`. The
    v1 delay guard applies; its final sentence is stored as `impact_note`.
  - Planner (PLAN + SIMULATE): `search_precedents`, `run_solver`. Two invocations sharing one
    conversation; `run_solver` takes strategies only and applies the case's constraints in
    code; a candidate it did not simulate is run by code (an Orchestrator event).
  - Critic (REFLECT): `check_business_rules` (deterministic) then `report_review` (notes per
    failing option, refused until the check ran); selection stays in code; then
    `write_explanation`.
  - Executor (ACT + VERIFY): `create_stock_transfer`, `request_approval`,
    `create_purchase_order`, `check_status` **plus `book_spot_air` and
    `reschedule_customer_order`** (missing from the brief's table; the replan to air needs
    them). Its actions are calls of the chosen plan made in code, as in v1; the model writes
    only the approval card `summary`.
- **v2 tools** (`agent/tools/v2.py`) are registered only in multi mode, so the v1 registry
  and Cedar action list are unchanged. Most are the v1 tools under the brief's names.
- **Allowlist = hard error**: checked in the model adapter (before Strands runs a tool) and
  in `_tool` for code paths. A violation is audited (`allowlist_violation`), shown as a
  `denied` event and escalates the case. Errors raised inside a Strands tool (budget,
  allowlist) are held, the loop is stopped, and they are re-raised after the agent returns
  (Strands turns tool exceptions into error results).
- **Bounded output**: 5 turns, then one nudge of 2 turns, then escalation (v1: 5 in total).
- **Events** carry `agent` (the stage's specialist; CASE events and escalations:
  "SIAGA Orchestrator"); audit `tool_call` entries carry `agent` in multi mode only.
- **Replay**: purposes `signal`, `impact`, `planner.plan`, `planner.simulate`,
  `critic.review`, `critic.explain`, `executor.summary`. The multi recording lives in
  `data/golden/multi/` (REPLAY_PATH default in multi mode); the v1 one is untouched.
  **The committed multi recording is a fake-LLM placeholder.**
- **Budget**: golden path 15 tool calls (13 to the approval card); reject → air → verify
  19 on the fake LLM. A real model that runs more lookups can bring the reject path close
  to 20 (then it escalates on budget, by design).
- **UI** (step 6 items that come with step 2):
  - The rail names each stage's agent: from events, else the team in `/config`
    (`orchestration`, `specialists`). Rows are 4.75rem only when agents exist.
  - Perceive puts the gloss under each Bahasa phrase (text-lg, `ink-2`). When glosses
    show, the PDF phrases flow on shared lines so the canvas still fits 1280×720
    (e2e-checked; the projector check passes in multi mode).
  - The drawer shows the agent per event and the specialists with their allowlists.
  - Planner mode shows the agent per stage, the Impact note, the Critic notes and the
    approval summary, each labelled "model-written".
- `make rehearse` reports `agent_s` (per-agent time, from `/config`).
- `scripts/dev.py --multi` for the no-make path.
- Results (fake LLM): pytest 171 passed; rehearse multi 10/10 fake and 10/10 replay;
  v1 3/3; web smoke multi 9/9 (fake) and 8/8 (replay), v1 8/8 + 1 skipped and 7/7.

### SIAGA v2 step 3 decisions (SAP RPT-1.6, `DELAY_MODEL=signal|rpt|fake`)

- **Combination rule (confirmed by the product owner, 25 Oct; `agent/delay_model.combine`)**:
  a prediction inside Perceive's range is used as a point delay; outside, it is clamped to
  the nearest bound and flagged "Model and signal disagree"; RPT unavailable → the signal
  range with a neutral "Prediction unavailable — using signal range" event. The risk
  function still computes every probability; a point is a zero-width uniform delay.
- **API from the SDK, not from memory**: the SAP docs hosts are blocked here, so the request
  and response shapes were read from the generated types of `@sap-ai-sdk/rpt` 2.17.0 (npm).
  `POST {AICORE_API_URL}/v2/inference/deployments/{id}/predict` with `AI-Resource-Group`;
  regression returns `prediction` plus `confidence_interval` (`confidence` is null), so
  the "confidence" SIAGA shows is that interval. OAuth client credentials at
  `{AICORE_AUTH_URL}/oauth/token`; the token is cached.
- **Data**: `data/history/disruptions.csv`, 80 synthetic rows (`scripts/make_history.py`,
  labelled in the file and `data/history/README.md`). The case row is built in code from
  the case: cause, corridor (lane → corridor table), month (WIB), signal count, official
  notice (a PDF signal); rain level unknown (null).
- **Demo timing**: PO 4500018231 was due Day 1 10:00 and the cutoff is Day 2 18:00, so any
  delay over 32 h keeps every golden number. Similar history rows (October-March Pantura
  floods with a notice) sit around 49–76 h; the offline stand-in predicts 64 h.
- **Tool `predict_delay`** (no arguments; registered only with DELAY_MODEL set; once per
  case). v1 path: code calls it before the ASSESS model and shows the model the delay to
  use. Multi: the Impact Agent calls it (prompt `impact_agent.v2`). The ASSESS guard
  refuses `compute_risk` before a prediction and with any other delay; the deterministic
  fallback predicts first.
- **Timeout**: one 5 s budget (`RPT_TIMEOUT_SECONDS`) for token + prediction; any error or
  timeout → unavailable, never an escalation.
- **Record / replay**: `RecordingPredictor` / `ReplayPredictor` (`rpt.jsonl` next to the
  LLM recording; per case, in order; no network). `make record-golden` records it when
  DELAY_MODEL is set. Replay with DELAY_MODEL set and no `rpt.jsonl` refuses to start.
- `DELAY_MODEL=fake` is an offline stand-in (median of similar rows), labelled "not RPT"
  everywhere it shows; for tests and runs without SAP.
- **Budget**: prediction adds one tool call. Multi golden path 16; reject → air → verify
  reaches exactly 20 on the fake LLM (allowed, no margin).
- Tests (`tests/test_delay_model.py`): request/response shape, the rule, OAuth + URL +
  headers through `httpx.MockTransport`, timeout / HTTP errors, record → replay, both
  orchestrations keep the golden numbers, clamping, timeout fallback; the recorded-answer
  test skips until a real RPT answer is recorded.

### SIAGA v2 step 1 decisions (mock S/4HANA on BTP, `SAP_MOCK_ON_BTP`)

- **Deploy files are committed in `deploy/btp/`** (26 Oct; before, the manifest was only
  generated into the git-ignored `build/btp/`, so the repo had none): `manifest.yml`
  (app `siaga-sap-mock`), `requirements.txt` (exact pins; a test checks them against the
  locked environment), `runtime.txt` `python-3.12.x`, `.cfignore`.
- **Package** (`make btp-package` → `build/btp/`, git-ignored): `services/sap_mock` without
  the in-process helper, `siaga_common` (settings, timeline), `data/seed`, plus the
  `deploy/btp/` files. You push from inside `build/btp/`, where `cf push` finds
  `manifest.yml` by default. The manifest has no `path:`, because how `path:` resolves
  under `-f` could not be checked against the CF docs. Rechecked 26 Oct: a clean
  Python 3.12 venv installed only from that `requirements.txt` runs the manifest's
  start command; the app answers 401 without the key and 200 with it, and reset works. pip,
  not uv: uv support only reached the official CF Python buildpack in mid-October 2026,
  and BTP may run an older buildpack. CF docs are blocked here; checked by search.
- **Manifest**: 512M, 1 instance, `python_buildpack`, `random-route: true` (unique host in
  the shared org, no domain guessing), port health check, uvicorn on `$PORT`.
  `SAP_MOCK_API_KEY` only via `cf set-env`.
- **API key**: `create_app(api_key=...)` (default: `SAP_MOCK_API_KEY` from the environment)
  adds a middleware that refuses every request without the right `X-API-Key`
  (constant-time compare, OData error, 401). No key configured = open, as before. The
  in-process mock (`EMBEDDED_SAP`, tests) never asks for one.
- **Switch**: `Settings.sap_endpoint()` returns (URL, headers): localhost or
  `SAP_MOCK_BTP_URL`; the key header is sent whenever `SAP_MOCK_API_KEY` is set. Used by
  the runtime, the Case API, the CLI probe, `make demo-reset` (resets the BTP copy) and
  `make preflight`. The BTP flag wins over `EMBEDDED_SAP`.
- `make sap-latency` measures round trips (stock lookup, filtered query, state).
- Verified here against `build/btp` run in a clean venv from its own requirements:
  401 without / with a wrong key, 200 with it, reset works; `make demo-reset`,
  `make sap-latency` (localhost: ~2 ms median) and `make rehearse N=3` (multi, fake LLM,
  fake delay model) 3/3, all 248 SAP calls served by the packaged app.

### SIAGA v2 steps 6 + 5 decisions (UI additions, PII masking)

- **Assess chip** (`delayChip` in `lib/present.ts`): "<h> h · Delay predicted by SAP
  RPT-1.6 · from 80 past disruptions" (brief wording), one line; the offline stand-in reads
  "Delay estimated offline (not RPT)"; disagreement adds "model and signal disagree" in
  the human (amber) tone; unavailable is a muted "Prediction unavailable — using signal
  range". Planner mode shows prediction, interval, signal range and the delay used.
  A point delay prints one arrival time (Impact panel, Verify note, Tier 0 note).
- **Architecture** (`components/ArchitectureView.tsx`): the brief's section 3 diagram,
  built only from `/config` (`orchestration`, `specialists`, `delay_model`,
  `pii_masking`, `joule_approvals`, `sap` {mode, host}, `backends`). Every box says what
  runs here now and the AWS / SAP target, live boxes teal, off boxes dashed. A tab in
  Planner mode (Case | Architecture) and in the details drawer.
- **PII masking** (`agent/pii.py`, `PII_MASKING=local`): at intake (`Agent.start_case`),
  before any model call: phone numbers (Indonesian formats, 9–14 digits), e-mails, and
  names marked by an honorific (Pak / Bu / Mas / Mbak / Mr …) or a label (Sopir: / a.n. /
  PIC:). Document numbers, quantities, dates and places are untouched, so evidence still
  locates. The case, events and every model see the masked text; the original is in the
  audit trail only (`pii_masked`; the audit view prints counts only). Case field `pii`
  (counts) drives the Planner chip ("PII masked · N" / "PII check · nothing to mask").
  The demo signals contain no personal data, so the demo shows "nothing to mask"; the
  masked example is in `tests/test_pii.py`. Vehicle plates are not masked.
- e2e `web/e2e/v2.spec.ts` checks the chip, the PII chip and the Architecture tab
  according to `/config` (skips what is off).
- **Next.js 16.4.0 → 16.4.3** (owner's decision, 25 Oct; an exception to the two-week
  rule): 16.4.0 had three critical advisories (two remote code execution, one DoS),
  fixed in 16.4.3. `next` and `eslint-config-next` are pinned exactly to 16.4.3.
  `npm audit`: 0 vulnerabilities. The last advisory was `zod` < 4.6.6 (high,
  GHSA-mrhx-c7xc-m3w5), reached only through the lint tooling
  (`eslint-config-next` → `eslint-plugin-react-hooks`), not shipped. It is fixed by
  `"overrides": {"zod": "4.6.6"}` in `web/package.json` (4.6.6 is two weeks old; 4.6.7 is
  not); drop the override once eslint-plugin-react-hooks requires ≥ 4.6.6. The CLI's "upgrade" stop of `next dev` /
  `next build` no longer appears. After the upgrade: web-check passes; web smoke v1 9/9
  (+1 skipped), v1 replay 8/8 (+1 skipped), multi + DELAY_MODEL=fake + PII 10/10, multi
  replay 9/9.
- Results: pytest 208 passed; web smoke with ORCHESTRATION=multi DELAY_MODEL=fake
  PII_MASKING=local 10/10; v1 9/9 (+1 skipped) and replay 8/8 (+1 skipped); rehearse v1
  3/3 fake and replay.

### Environment and secrets setup (`SIAGA_env_setup_prompt.md`, 25 Oct)

- **Leak check:** gitleaks 8.28.0 over all 27 commits found nothing. Over the working tree it
  flagged 45 hits, all in git-ignored build output (`var/audit` idempotency keys, Next.js
  preview/encryption keys in `web/.next*`, `build/`). `git grep` / `git log -p` for `AKIA` and
  `aws_secret_access_key` found only variable names. No `.env` was ever committed.
- **Map:** `docs/connections.md`. The secret `siaga/sap` holds `SAP_MOCK_BTP_URL`, which is
  the brief's `SAP_MOCK_URL` row; `SAP_MOCK_URL` stays the local / AWS-hosted mock.
- **`siaga_common/sources.py`** holds:
  - `with_secrets` (the secret is read once per process and cached; errors name keys, never
    values);
  - `SsmFlags` (paginated read; writes only known names);
  - `overlay` (a validated settings copy that never re-reads the environment and derives the
    multi `REPLAY_PATH` again);
  - `snapshot`;
  - the presets `FLAGS_V2` / `FLAGS_V1`.
  `BEDROCK_MODEL_ID` is an SSM parameter too. It is read per case, and the presets copy it
  from the laptop `.env`.
- **Per-case flags in the Case API:**
  - Every `POST /cases` reads the flags and gets the agent built for those values. Agents
    are cached per resulting settings and share the store, audit, KB and solver; a new SAP
    client is built only when `SAP_MOCK_ON_BTP` changes, and a new LLM provider only when
    the provider, model or replay recording changes.
  - Approvals and VERIFY find the case's agent again from `case.flags`.
  - If SSM fails, the case uses the last flags read and gets a `flags_warning` audit entry.
  - `/config`, `/demo/reset` and `/demo/inject` use the current flags.
  - Backend settings apply only when the process starts.
- **Audit:** the `case` entry carries `flags` and `flags_source`. The `CaseRecord` gets
  `flags`.
- **Case API key:**
  - When `CASE_API_KEY` is set, every request except `GET /health` (and CORS `OPTIONS`)
    needs `X-API-Key`. The compare is constant-time; a missing or wrong key gets a 401.
  - The dashboard adds the key on its server in `web/proxy.ts`. This is the Next 16 Proxy:
    request headers set there reach the rewrite destination. `next.config.ts` reads
    `CASE_API_URL` / `CASE_API_KEY` from the repo root `.env`; the shell wins.
  - The browser never sees the key. This was checked against a keyed API: 401 direct, 200
    through the dashboard.
- **`GET /health/connections?deep=1`** (needs the key) checks from inside the process:
  - the secret (key names present or missing);
  - the flags and their source;
  - SAP, through the agent's own SAP client;
  - the backends;
  - with `deep=1`, one Bedrock ping and one RPT-1.6 call on the demo row
    (`delay_model.demo_query`).
  No secret value is ever returned (tested).
- **Laptop modes:**
  - `.env.{aws,replay,v1}.example` are committed; the real files are git-ignored (checked
    with `git check-ignore` in a test).
  - `scripts/env_mode.py` (`make use-*`, `make env-check`) keeps the previous `.env` in
    `var/env-backup/`. It flags things that do not belong in a mode, such as access keys in
    `.env.aws`.
  - Replay mode uses the new **`data/golden/v2/`**: multi + `DELAY_MODEL` + PII,
    **recorded from the fake LLM and the offline delay stand-in (placeholder; the chip
    reads "not RPT")**. The template runs offline to the golden outcome (tested).
- **`scripts/fill-env.sh`:**
  - It reads `CASE_API_URL` from the output `CaseApiUrl` of the stack `Siaga`.
  - It asks for `CASE_API_KEY` hidden, or generates one.
  - It writes files with mode 600 and keeps a `.bak` of each previous file.
- **`scripts/put-sap-secret.sh`:**
  - It creates `siaga/sap` if it is missing, with no value. There is no IaC yet, and the
    stack will reference the secret by name (`infra/README.md`).
  - It reads the AI Core service key JSON itself (`url`, `clientid`, `clientsecret`,
    `serviceurls.AI_API_URL`; the `credentials` nesting is handled). The other values are
    asked hidden; Enter keeps a current value.
  - It stores the secret through a mode-600 temp file, never through a command line.
  - Both scripts were tested with a stub `aws`: no value appears in stdout, stderr or any
    aws command line.
- **IAM template:** `infra/iam/siaga-config-read.json` allows GetSecretValue on
  `siaga/sap-??????` and GetParametersByPath on `/siaga/flags`. It is for the Runtime role
  and the Case API Lambda only.
- **`make preflight`:**
  - In mode aws it prints 9 lines with ✅ / ❌:
    1. the STS account and user name;
    2. env-check;
    3. the Case API: key enforced and accepted;
    4. to 8. from `/health/connections`: secret, Bedrock, BTP mock (must be BTP), AI Core,
       AWS backends;
    9. the SSM flags against flags-v2 + the model ID.
  - In the local modes it runs the existing checks plus an env-mode line.
  - `make demo-reset` in mode aws posts `/demo/reset` to the deployed API, which resets the
    mock that the current flags point to (BTP under flags-v2).
- `make help` now lists targets with digits (`use-v1`, `flags-v2`).
- Results:
  - pytest 223 passed (15 new);
  - web-check passes;
  - web smoke v1 (fake) 9/9 (+1 skipped) through the new proxy.

### Laptop live, SAP AI Core LLM and fallback (owner's decisions, 25 Oct)

- **No Phase 7.** Demo Day default is mode **`local`** (`.env.local.example`,
  `make use-local`). The whole stack runs on the laptop with local backends; flags come
  from `.env`: multi, `DELAY_MODEL=rpt`, `SAP_MOCK_ON_BTP=1`, `PII_MASKING=local`,
  `JOULE_APPROVALS=0`. Live calls go to the LLM, the BTP mock and RPT-1.6. The SAP values
  sit in the git-ignored `.env.local`, written with hidden input by `scripts/fill-env.sh`
  (it reads the AI Core service key JSON). `REPLAY_PATH=data/golden/v2/llm.jsonl` there
  makes `make record-golden` write the recording that `make use-replay` plays. Runbook:
  `docs/demo-day-runbook.md`.
- **How Claude runs on SAP AI Core** was read from SAP's SDK source, not guessed. The SAP
  docs hosts are blocked here, and a web search found no page on it. Sources:
  `sap-ai-sdk-gen` 7.4.1, files `gen_ai_hub/proxy/native/amazon/clients.py` and
  `gen_ai_hub/proxy/gen_ai_hub_proxy/client.py`. The model name
  `anthropic--claude-4.6-sonnet` is in the model list of `@sap-ai-sdk/orchestration`
  2.17.0. The steps:
  1. **Find the deployment:** `GET {AI_API_URL}/v2/lm/deployments?scenarioId=foundation-models&status=RUNNING`
     with the `AI-Resource-Group` header. The model name is
     `details.resources.backend_details.model.name`, or else the configuration's
     `modelName` binding.
  2. **Call it:** the AI Core deployment proxies the Bedrock runtime API. The unsigned
     Converse body goes to `{deploymentUrl}/converse` with `Authorization: Bearer` and
     `AI-Resource-Group`, and the response is the Converse response.
- **`agent/aicore.py`** holds the OAuth token (cached), the deployment lookup, and the
  errors (they never echo the client ID).
- **`agent/providers/sap_genai.py`** reuses `BedrockProvider._kwargs`, dropping `modelId`,
  so the request is byte-for-byte the Bedrock body:
  - 429 / 5xx and connection errors are retried visibly (`on_retry`);
  - a 401 refreshes the token once;
  - a rejected temperature is dropped once.
  The model is reported as `sap:<name>`. Recording and replay are unchanged.
- **`LLM_FALLBACK=sap_genai`** (`agent/providers/fallback.py`):
  - `LLMError` now has a `kind` (`account` / `throttle` / `other`). The Bedrock provider
    sets it from the error code and message ("Operation not allowed", access denied,
    invalid token → account).
  - With a fallback set, Bedrock gets 2 attempts, so throttling moves the case quickly.
  - A case moves only if its **first** primary call fails that way. Once Bedrock has
    answered a case, later errors escalate as before.
  - The first fallback answer writes an `llm_fallback` audit entry and a `fallback` event
    titled "Model: Claude via SAP AI Core".
  - Presenter (header) and Planner (badge) show that note whenever the case's llm events
    ran on `sap:` (`sapModelNote` in `lib/present.ts`). `modelLabel()` replaces three
    copies of the provider label.
- **`make preflight` in mode local**, one line per connection:
  - env-check;
  - AWS identity (amber when the LLM is `sap_genai`);
  - one tool call to Bedrock and, separately, one to the SAP fallback;
  - the BTP mock: refuses calls without the key, accepts ours, day 0 = today;
  - the AI Core token + one RPT-1.6 call;
  - local stores (SQLite, audit dir, KB, local backends);
  - then the `make dev` processes, CBC and Cedar.
  `/health/connections` uses the same ping (`agent.providers.ping`; key `llm`).
- First laptop run (owner, 25 Oct) found three problems, now fixed:
  - Preflight crashed on a missing `siaga` AWS profile. The Bedrock client is now built on
    first use inside `converse()`, so a missing profile, credentials or `BEDROCK_MODEL_ID`
    becomes `LLMError(kind="account")`, and with `LLM_FALLBACK` the case moves to SAP.
  - With the fallback set, preflight shows Bedrock problems in amber, not red.
  - `<set-me>` template values now count as unset, so messages name the missing
    variable.
- `make record-golden --provider sap_genai` works, and `meta.json` names the provider that
  answered (`provider`, `configured_provider`, `fallback_reason`, `models`).
- Tests (`tests/test_sap_genai.py`, 16): the deployment lookup by name and through the
  configuration; the URL, headers and body; retries, refresh, error kinds, temperature;
  the factory; the fallback rules; record → replay keeps `fallback_reason`; and full demo
  cases over the simulated wire (v1 and multi, plus Bedrock blocked → SAP with exactly one
  note). Preflight in mode local was run against an AI Core stand-in and a keyed mock SAP:
  every line answers.

## Open items

- AWS credentials in the build container are proxy placeholders; STS returns
  `InvalidClientTokenId`. Still to run once they exist: `make aws-probe`, pick the model,
  `make eval-perceive` (target ≥ 18/20), `make demo` with Bedrock ×3 for stability and
  per-stage timings, `make record-golden` (replace the fake placeholder), and
  `make rehearse N=10` against Bedrock.
- Bedrock on the owner's account returns `ValidationException: Operation not allowed` for
  every model call: Anthropic's first-time use form (Bedrock console > Model catalog) was
  not submitted; check Nova to rule out an account-level block. v2 step 2 still needs
  3 Bedrock runs with per-agent timings (< 4 min total) and a Bedrock multi recording.
- SAP variables were added to the environment after this session started, so they do not
  reach it; a new session (or `.env` on the laptop) picks them up. Then: `make sap-check`,
  `DELAY_MODEL=rpt` demo run, `DELAY_MODEL=rpt make record-golden`.
- Phase 7 is dropped (owner, 25 Oct); mode aws stays a design.
- Live runs wait for credentials that reach this session (or the laptop). In the 25 Oct
  session the AWS key still gave `InvalidClientTokenId`, and no `AICORE_*` / BTP variable
  was present. Then: `make use-local`, `make preflight`,
  `LLM_PROVIDER=sap_genai make record-golden` (real `data/golden/v2/`; the "(fake)"
  replay label goes away with it), and `make rehearse N=3` with per-stage timings.
- `BEDROCK_MODEL_ID` not chosen yet (owner will send the model list; not blocking
  before the end of Phase 4).
