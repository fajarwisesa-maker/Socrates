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
| 7 AWS deployment | design note `docs/phase7-design.md` awaiting approval; build blocked on AWS access |
| 8 | not started |
| UI redesign (`SIAGA_ui_redesign_prompt.md`) | step 1 audit done (`docs/ui-redesign-audit.md`); backend additions A–G and step 2 in progress |

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

Screenshots of a full local run (fake LLM): `docs/screenshots/`.

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
| `LLM_PROVIDER` | `bedrock` | `bedrock` \| `fake` \| `replay` |
| `BEDROCK_MODEL_ID` | **none** | model or inference-profile ID; no default in code by design |
| `AWS_REGION` | `ap-southeast-1` | |
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
- **Dashboard** (`web/`, Next.js 16.4 App Router + TS + Tailwind 4): one page, a server
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

## Open items

- AWS credentials in the build container are proxy placeholders; STS returns
  `InvalidClientTokenId`. Still to run once they exist: `make aws-probe`, pick the model,
  `make eval-perceive` (target ≥ 18/20), `make demo` with Bedrock ×3 for stability and
  per-stage timings, `make record-golden` (replace the fake placeholder), and
  `make rehearse N=10` against Bedrock.
- `BEDROCK_MODEL_ID` not chosen yet (owner will send the model list; not blocking
  before the end of Phase 4).
