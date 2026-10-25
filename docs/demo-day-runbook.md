# Demo Day runbook (31 Oct 2026)

Default: **laptop live** (`make use-local`). Fallbacks, each one command: `make use-replay`
(offline, recorded run), then `make use-v1` (v1 behaviour on Bedrock). Where every value
lives: `docs/connections.md`. No secret is ever typed into a chat or a command line.

## Once, before the day

```bash
git pull && uv sync && (cd web && npm ci)
scripts/fill-env.sh            # hidden input: writes .env.local / .env.replay / .env.v1 / .env.aws
make use-local
make env-check                 # every variable of mode local: set
make demo-reset                # day 0 = today on the BTP mock
make preflight                 # all green (see below)
make record-golden             # a real run -> data/golden/v2/ (what make use-replay plays)
make rehearse N=3              # stage timings in var/rehearse/
```

`make record-golden` keeps a recording only if the run reaches the golden outcome
(Rp 11.400.000 plan, transfer executed, bridge PO approved, RESOLVED). `meta.json` names
the provider that answered (`bedrock` or `sap_genai`).

## The three modes

| Command | What runs | Model | SAP | Use when |
| --- | --- | --- | --- | --- |
| `make use-local` | `make dev` on the laptop, local stores | Bedrock, or Claude via SAP AI Core (fallback or `LLM_PROVIDER=sap_genai`) | BTP mock + RPT-1.6, live | default |
| `make use-replay` | `make dev` on the laptop | the recorded run in `data/golden/v2/` (REPLAY badge) | local mock; RPT answers from the recording | no network, or a live service misbehaves |
| `make use-v1` | `make dev` on the laptop | Bedrock | local mock, no RPT | the v2 path itself misbehaves |

After switching: stop `make dev` (Ctrl-C), `make use-<mode>`, `make dev`,
`make demo-reset`, reload the dashboard. Nothing else changes.

## Preflight in mode local (`make preflight`)

1. `.env` mode local and env-check
2. laptop AWS identity (only when `LLM_PROVIDER=bedrock`)
3. LLM: one tool call to Bedrock and, separately, to the fallback Claude via SAP AI Core
4. BTP mock: refuses a call without the key, accepts ours, day 0 = today
5. AI Core token + one RPT-1.6 call on the demo case
6. local stores (SQLite cases, audit files, KB)
7. Case API and dashboard up (`make dev`), CBC solver, Cedar policies

Red = blocker. Amber = read it (for example: day 0 is not today, so run `make demo-reset`).

## On stage

- Start: dashboard at http://localhost:3000, Presenter mode, **Reset demo** in the `D` drawer.
- If Bedrock refuses the case at its start, it runs on Claude via SAP AI Core by itself. The
  header shows "Model: Claude via SAP AI Core", and the audit trail has an `llm_fallback` entry.
- If something live fails mid-case: Ctrl-C, `make use-replay`, `make dev`, `make demo-reset`,
  then start the case again. The REPLAY badge is visible.
