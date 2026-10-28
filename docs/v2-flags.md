# SIAGA v2 feature flags

Every v2 feature sits behind one of these flags. Each flag defaults to **off** until its
checkpoint passes. With every flag off, SIAGA behaves exactly like the `v1-demo` tag
(commit `7bccb9a`).

All flags are read through `siaga_common/settings.py`. Locally they come from `.env` or
the shell (the shell wins). The deployed agent reads them from SSM Parameter Store
`/siaga/flags/<NAME>` (`FLAGS_SOURCE=ssm`) at the start of every case, so `make flags-v2` /
`make flags-v1` switch the next case without a redeploy; `make flags-show` prints them.
Each case records the values it ran with (`case.flags` and its `case` audit entry). The
full map of what lives where: `docs/connections.md`.

| Preset | ORCHESTRATION | DELAY_MODEL | SAP_MOCK_ON_BTP | PII_MASKING | JOULE_APPROVALS | LLM_PROVIDER / REPLAY | backends |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `make flags-v2` (Demo Day) | multi | rpt | 1 | local | 0 | bedrock / 0 | dynamodb, s3, bedrock, agentcore, lambda |
| `make flags-v1` | single | signal | 0 | off | 0 | bedrock / 0 | same AWS backends |

Both presets also store `BEDROCK_MODEL_ID` from the laptop's `.env` when it has one.

| Flag | Values (default first) | Step | What it switches | Status |
| --- | --- | --- | --- | --- |
| `ORCHESTRATION` | `single` \| `multi` | 2 | `single`: the v1 state machine calls the LLM per stage. `multi`: the same deterministic orchestrator delegates each stage to a specialist Strands agent (Signal, Impact, Planner, Critic, Executor), each with its own system prompt and tool allowlist. | done with the fake LLM; Bedrock runs pending |
| `SAP_MOCK_ON_BTP` | `0` \| `1` | 1 | `0`: the mock S/4HANA at `SAP_MOCK_URL` (localhost). `1`: the copy on SAP BTP Cloud Foundry at `SAP_MOCK_BTP_URL`, with the `X-API-Key` header from `SAP_MOCK_API_KEY`. Nothing else changes. | package + key check built and tested locally (`make btp-package`, docs/btp-deploy.md); waiting for the owner's `cf push` |
| `DELAY_MODEL` | `signal` \| `rpt` \| `fake` | 3 | `signal`: the delay range read by Perceive. `rpt`: SAP RPT-1.6 on AI Core predicts `delay_hours` from the synthetic disruption history; code uses it inside the signal range, clamps and flags it outside (rule confirmed 25 Oct). Falls back to the signal range after 5 s (`RPT_TIMEOUT_SECONDS`). `fake`: offline stand-in, labelled "not RPT". | built; real RPT call pending (SAP variables not in this session) |
| `JOULE_APPROVALS` | `0` \| `1` | 4 | Tier 3 approvals can also come from the "SIAGA" Joule capability, through the same endpoint, policy check and audit record (`channel: "joule"`). | not started (the setting is read and recorded, nothing uses it) |
| `AUTO_EXEC_CAP` | `0` \| `1` | 5 | Cap a case's total Tier 2 auto-executions at Rp 50.000.000. | dropped (owner, 25 Oct) |
| `WHATSAPP_INBOUND` | `0` \| `1` | owner, 28 Oct | A signed WhatsApp message from an allowed sender to the team's test number opens a case. The webhook app (`make whatsapp`, :8010) is the only thing the tunnel exposes. Needs `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_ALLOWED_SENDERS` (`scripts/fill-whatsapp.sh`); docs/whatsapp-inbound.md | built; tested with signed payloads and in the browser |
| `WHATSAPP_NOTIFY` | `0` \| `1` | owner, 28 Oct | Option B, with `WHATSAPP_INBOUND=1`: when a WhatsApp case is RESOLVED, ESCALATED or REOPENED, the sender gets one reply with the outcome ("Rp 340 jt protected for Rp 11,4 jt"), written by code. Needs `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` (`scripts/fill-whatsapp.sh`); docs/whatsapp-inbound.md §B | built; tested against a stand-in Cloud API |
| `PII_MASKING` | `off` \| `local` | 5 | Mask phone numbers, e-mails and personal names in incoming signals at intake, before any model call; the original stays in the audit trail only (`pii_masked`). `guardrails` (Bedrock Guardrails) is not built: it needs AWS access. | done (local) |

## LLM provider (not a v2 flag)

| Variable | Values (default first) | What it does |
| --- | --- | --- |
| `LLM_PROVIDER` | `bedrock` \| `sap_genai` \| `fake` \| `replay` | `sap_genai`: Claude (`SAP_GENAI_MODEL`, default `anthropic--claude-4.6-sonnet`) on SAP AI Core, through the Bedrock Converse API that the AI Core foundation-model deployment proxies. The request, the response and the recording are the same as for Bedrock (`agent/providers/sap_genai.py`) |
| `LLM_FALLBACK` | unset \| `sap_genai` | with `LLM_PROVIDER=bedrock`: if a case's **first** Bedrock call fails with an account error (e.g. "Operation not allowed", access denied, invalid token) or is still throttled after one retry, that case runs on Claude via SAP AI Core. The dashboard then shows "Model: Claude via SAP AI Core". Later errors in a case that Bedrock already answered escalate as usual |

## Related settings (not flags)

| Variable | Used by | Notes |
| --- | --- | --- |
| `AICORE_AUTH_URL`, `AICORE_CLIENT_ID`, `AICORE_CLIENT_SECRET`, `AICORE_API_URL` | step 3 | SAP AI Core service key (OAuth client credentials). Set in the environment settings; never printed or committed. |
| `AICORE_RESOURCE_GROUP` | step 3 | `default` |
| `AICORE_RPT_DEPLOYMENT_ID` | step 3 | deployment of `sap-rpt-1.6` |
| `SAP_MOCK_URL` | all | local mock S/4HANA (`http://127.0.0.1:8001`) |
| `SAP_MOCK_BTP_URL` | step 1 | the Cloud Foundry route of the mock (`cf app siaga-sap-mock`) |
| `SAP_MOCK_API_KEY` | step 1 | `X-API-Key` for the BTP-hosted mock (the CF org is shared) |
| `CASE_API_KEY` | env setup | when set, the Case API requires `X-API-Key` (the dashboard proxy, preflight and rehearse send it); the deployed API reads it from `siaga/sap` |
| `FLAGS_SOURCE` / `SECRETS_SOURCE` / `SAP_SECRET_ID` | env setup | `env` locally; `ssm` / `aws` / `siaga/sap` for the deployed agent |

## Turning v2 off

```bash
ORCHESTRATION=single SAP_MOCK_ON_BTP=0 DELAY_MODEL=signal JOULE_APPROVALS=0 \
AUTO_EXEC_CAP=0 PII_MASKING=off make dev
```

Every flag defaults to off, so removing these lines from `.env` has the same effect. On the
laptop the one-command switches are `make use-local` (Demo Day), `make use-replay` and
`make use-v1` (docs/demo-day-runbook.md). `make use-aws` and `make flags-v2` / `make flags-v1`
belong to the AWS production design, which is not deployed (owner, 25 Oct).
