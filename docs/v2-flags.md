# SIAGA v2 feature flags

Every v2 feature sits behind one of these flags. Each flag defaults to **off** until its
checkpoint passes. With every flag off, SIAGA behaves exactly like the `v1-demo` tag
(commit `7bccb9a`).

All flags are read through `siaga_common/settings.py`. They can be set in `.env` or in
the shell (the shell wins).

| Flag | Values (default first) | Step | What it switches | Status |
| --- | --- | --- | --- | --- |
| `ORCHESTRATION` | `single` \| `multi` | 2 | `single`: the v1 state machine calls the LLM per stage. `multi`: the same deterministic orchestrator delegates each stage to a specialist Strands agent (Signal, Impact, Planner, Critic, Executor), each with its own system prompt and tool allowlist. | done with the fake LLM; Bedrock runs pending |
| `SAP_MOCK_ON_BTP` | `0` \| `1` | 1 | `0`: the mock S/4HANA at `SAP_MOCK_URL` (localhost). `1`: the copy on SAP BTP Cloud Foundry at `SAP_MOCK_BTP_URL`, with the `X-API-Key` header from `SAP_MOCK_API_KEY`. Nothing else changes. | package + key check built and tested locally (`make btp-package`, docs/btp-deploy.md); waiting for the owner's `cf push` |
| `DELAY_MODEL` | `signal` \| `rpt` \| `fake` | 3 | `signal`: the delay range read by Perceive. `rpt`: SAP RPT-1.6 on AI Core predicts `delay_hours` from the synthetic disruption history; code uses it inside the signal range, clamps and flags it outside (rule confirmed 25 Oct). Falls back to the signal range after 5 s (`RPT_TIMEOUT_SECONDS`). `fake`: offline stand-in, labelled "not RPT". | built; real RPT call pending (SAP variables not in this session) |
| `JOULE_APPROVALS` | `0` \| `1` | 4 | Tier 3 approvals can also come from the "SIAGA" Joule capability, through the same endpoint, policy check and audit record (`channel: "joule"`). | not started |
| `AUTO_EXEC_CAP` | `0` \| `1` | 5 | Cap a case's total Tier 2 auto-executions at Rp 50.000.000 (AgentCore temporal policy if available, else Cedar context + in-code check). | not started |
| `PII_MASKING` | `off` \| `local` \| `guardrails` | 5 | Mask phone numbers and personal names in incoming signals before any LLM call; the original stays in the audit trail only. | not started |

## Related settings (not flags)

| Variable | Used by | Notes |
| --- | --- | --- |
| `AICORE_AUTH_URL`, `AICORE_CLIENT_ID`, `AICORE_CLIENT_SECRET`, `AICORE_API_URL` | step 3 | SAP AI Core service key (OAuth client credentials). Set in the environment settings; never printed or committed. |
| `AICORE_RESOURCE_GROUP` | step 3 | `default` |
| `AICORE_RPT_DEPLOYMENT_ID` | step 3 | deployment of `sap-rpt-1.6` |
| `SAP_MOCK_URL` | all | local mock S/4HANA (`http://127.0.0.1:8001`) |
| `SAP_MOCK_BTP_URL` | step 1 | the Cloud Foundry route of the mock (`cf app siaga-sap-mock`) |
| `SAP_MOCK_API_KEY` | step 1 | `X-API-Key` for the BTP-hosted mock (the CF org is shared) |
| `CASE_API_KEY` | step 4 | API key for the HTTPS Case API used by Joule |

## Turning v2 off

```bash
ORCHESTRATION=single SAP_MOCK_ON_BTP=0 DELAY_MODEL=signal JOULE_APPROVALS=0 \
AUTO_EXEC_CAP=0 PII_MASKING=off make dev
```

Every flag defaults to off, so removing these lines from `.env` has the same effect. The
demo-day runbook (step 7) will give the one-command switch.
