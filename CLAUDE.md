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
| 2 Solver and risk | done — awaiting checkpoint review |
| 3–8 | not started |

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

## Open items

- AWS credentials in the build container are proxy placeholders; STS returns
  `InvalidClientTokenId`. Model list + Converse check still to run.
- `BEDROCK_MODEL_ID` not chosen yet (owner will send the model list; not blocking
  before the end of Phase 4).
