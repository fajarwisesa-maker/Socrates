# Connections: where each piece of configuration lives

No secret value appears in this file, in git, or in any deploy template. Secrets are
entered only with hidden input, by the owner, through `scripts/fill-env.sh` (laptop files)
and `scripts/put-sap-secret.sh` (AWS Secrets Manager).

> **Decision (owner, 25 Oct): no Phase 7.** Demo Day runs in laptop mode **`local`**
> ("laptop live"): the whole stack on the laptop with local stores, live calls to the LLM,
> the BTP mock and RPT-1.6, and the SAP values in the git-ignored `.env.local`. The AWS
> parts below (the `siaga/sap` secret, SSM flags, `/health/connections` from AWS, mode
> `aws`) stay in the code as the production design; nothing is deployed.

## Names and places

| What | Name / location | State on 25 Oct |
| --- | --- | --- |
| AWS region | `ap-southeast-1` (Singapore) | — |
| Laptop AWS profile | `siaga` (`aws configure` / `aws sso login --profile siaga`) | owner's laptop |
| SAP secret | Secrets Manager `siaga/sap` in `ap-southeast-1` (JSON object, keys below) | created by `put-sap-secret.sh` on its first run |
| Flags | SSM Parameter Store, String parameters `/siaga/flags/<NAME>` | written by `make flags-v2` / `make flags-v1` |
| Deployed stack | CloudFormation stack `Siaga` (override: `SIAGA_STACK`), output `CaseApiUrl` | **not deployed**: Phase 7 is still a design (`docs/phase7-design.md`) |
| BTP mock | Cloud Foundry app `siaga-sap-mock` (random route; `cf app siaga-sap-mock`) | waiting for the owner's `cf push` (`docs/btp-deploy.md`) |
| AI Core | the AI Core service key of the owner's subaccount; deployment of `sap-rpt-1.6` | values not visible to the build session |
| Laptop env files | `.env.local`, `.env.replay`, `.env.v1`, `.env.aws` (git-ignored, mode 600); `.env` = the active one | templates committed as `.env.*.example`; written by `scripts/fill-env.sh` |
| Claude on SAP AI Core | Generative AI Hub model `anthropic--claude-4.6-sonnet`, scenario `foundation-models`, resource group `default` | needs a RUNNING deployment of that model in the subaccount |

## Who needs what

Mode `local` (Demo Day) keeps everything it needs in `.env.local`: `AWS_PROFILE=siaga` (no
keys), `BEDROCK_MODEL_ID`, `LLM_PROVIDER` / `LLM_FALLBACK=sap_genai`, the `AICORE_*` values
(RPT-1.6 and Claude on AI Core), `SAP_MOCK_BTP_URL` + `SAP_MOCK_API_KEY`, and the v2 flags.
The table below is the production (AWS) design.

| Value | Laptop `.env.aws` | Claude Code env | Secrets Manager `siaga/sap` | SSM `/siaga/flags/*` | BTP app (`cf set-env`) |
| --- | --- | --- | --- | --- | --- |
| AWS credentials | `AWS_PROFILE=siaga` only | set, but STS answers `InvalidClientTokenId` in this session | — | — | — |
| `AWS_REGION` | ✓ | default `ap-southeast-1` | — | — | — |
| `BEDROCK_MODEL_ID` | ✓ (preflight, replay recording) | not set | — | ✓ (`make flags-v2` copies it from the laptop) | — |
| `CASE_API_URL` | ✓ (`aws`: stack output `CaseApiUrl`; local modes: `http://127.0.0.1:8000`) | default | — | — | — |
| `CASE_API_KEY` | ✓ (`aws` only) | not set | ✓ (the API checks it) | — | — |
| `AICORE_AUTH_URL`, `AICORE_CLIENT_ID`, `AICORE_CLIENT_SECRET`, `AICORE_API_URL`, `AICORE_RESOURCE_GROUP`, `AICORE_RPT_DEPLOYMENT_ID` | — | not in this session (added after it started) | ✓ | — | — |
| BTP mock URL + `SAP_MOCK_API_KEY` | — | not set | ✓ (`SAP_MOCK_BTP_URL`, `SAP_MOCK_API_KEY`) | — | `SAP_MOCK_API_KEY` ✓ |
| v2 flags + backend settings | `replay` / `v1` only (no SSM offline) | — | — | ✓ | — |

The brief's `SAP_MOCK_URL` row is the BTP copy of the mock. In code that URL is
`SAP_MOCK_BTP_URL`; `SAP_MOCK_URL` stays the local (later AWS-hosted) mock that
`SAP_MOCK_ON_BTP=0` uses. So the secret stores `SAP_MOCK_BTP_URL`.

## How the code reads them

| Setting | Where it comes from |
| --- | --- |
| `SECRETS_SOURCE=env` (default) | SAP values from the environment / `.env` (local runs, tests, the Claude Code env) |
| `SECRETS_SOURCE=aws` (deployed agent) | `siaga/sap`, read **once at process start** with the process's IAM role and cached (`siaga_common/sources.py`). Missing keys are reported by name by `/health/connections`, and `make preflight` fails on them |
| `FLAGS_SOURCE=env` (default) | flags from the environment / `.env` |
| `FLAGS_SOURCE=ssm` (deployed agent) | `/siaga/flags/*` read **at the start of every case**. The case stores the values it ran with (`case.flags` and its `case` audit entry), and its approvals and VERIFY use the same agent. If SSM fails, the last values read are used and the case gets a `flags_warning` audit entry. Backend settings (`CASE_STORE` …) apply when the process starts |
| `CASE_API_KEY` | when set, the Case API requires `X-API-Key` on every request except `GET /health`. The dashboard adds it **on its server** (`web/proxy.ts`, key from the root `.env`), so the browser never sees it. `make preflight` and `make rehearse` send it too |

What changed in the code to match this map (env setup, 25 Oct):

- The SAP values used to come only from the environment. The deployed agent now reads them
  from `siaga/sap` (`SECRETS_SOURCE=aws`).
- The flags used to be read once per process from the environment. With
  `FLAGS_SOURCE=ssm` they are read for every case, and the flag values are recorded per case.
- Before, nothing checked `CASE_API_KEY`. Now the Case API enforces it, and the dashboard, preflight
  and rehearse send it.
- New SSM parameter `BEDROCK_MODEL_ID` (read per case, like the flags).
- `make sap-check` / `make predict-demo` still read AI Core values from the environment:
  they are tools for the Claude Code env (or a laptop shell), not part of any laptop mode.

## The AI Core values in `siaga/sap`

The AI Core service key (BTP cockpit → subaccount → Instances and Subscriptions → the AI Core
instance → Service Keys; the same JSON the keybroker hands out) maps like this.
`put-sap-secret.sh` reads the file and does the mapping itself:

| Key in `siaga/sap` | Service key field |
| --- | --- |
| `AICORE_AUTH_URL` | `url` (the UAA URL; SIAGA appends `/oauth/token`) |
| `AICORE_CLIENT_ID` | `clientid` |
| `AICORE_CLIENT_SECRET` | `clientsecret` |
| `AICORE_API_URL` | `serviceurls.AI_API_URL` |
| `AICORE_RESOURCE_GROUP` | not in the key: the resource group of the deployment (`default`) |
| `AICORE_RPT_DEPLOYMENT_ID` | not in the key: AI Launchpad → ML Operations → Deployments → the `sap-rpt-1.6` deployment's ID |

A `cf service-key` output nests these under `credentials`; the script handles both shapes.

## Laptop modes (one command each)

| Command | Mode | What runs where |
| --- | --- | --- |
| `make use-local` | `local` (**Demo Day default**) | everything on the laptop (`make dev`), local stores; live LLM (Bedrock with the SAP AI Core fallback, or `sap_genai`), the BTP mock and RPT-1.6; v2 flags from `.env` |
| `make use-aws` | `aws` (production design, not deployed) | the laptop runs only the dashboard (`make web`), `make preflight` and `make rehearse`, all against the deployed Case API with `CASE_API_KEY`; flags from SSM |
| `make use-replay` | `replay` (offline fallback) | everything on the laptop (`make dev`) from `data/golden/v2/` (LLM + RPT answers recorded); no network to Bedrock, SAP or BTP |
| `make use-v1` | `v1` (oldest fallback) | everything on the laptop (`make dev`), v1 behaviour, all v2 flags off, Bedrock via `AWS_PROFILE=siaga` |

`make env-check` lists each variable the active mode needs as `set` or `MISSING`, and flags
anything that does not belong in the mode (for example AWS access keys in `.env.aws`). It
never prints a value.

## IAM (for the Phase 7 stack)

Only the AgentCore Runtime role and the Case API Lambda get read access, each on the one
resource it needs. Template: `infra/iam/siaga-config-read.json`.

- `secretsmanager:GetSecretValue` on the ARN of `siaga/sap` only (`…:secret:siaga/sap-??????`).
- `ssm:GetParametersByPath` on `arn:aws:ssm:ap-southeast-1:<account>:parameter/siaga/flags`
  (and `…/siaga/flags/*`); writing the flags stays a laptop action (`make flags-v2`).
- No `secretsmanager:*`, no `kms:Decrypt` beyond the default `aws/secretsmanager` key, no
  access for the tools / solver Lambdas (they never see SAP secrets).
