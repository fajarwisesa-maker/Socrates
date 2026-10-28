# infra/ — AWS IaC (Phase 7; design in docs/phase7-design.md, awaiting approval)

Nothing is deployed yet. What the Phase 7 stack must do for configuration and secrets
(docs/connections.md):

- **Secret `siaga/sap`**: the stack references it by name and never carries a value. It is
  created and filled by `scripts/put-sap-secret.sh` (run by the owner with
  `AWS_PROFILE=siaga`), so no template or CDK synth output ever contains it. (CDK:
  `secretsmanager.Secret.from_secret_name_v2(self, "SapSecret", "siaga/sap")`.)
- **Flags** `/siaga/flags/*`: written by `make flags-v2` / `make flags-v1`, not by the
  stack, so switching needs no redeploy.
- **IAM**: only the deployed agent's role and the Case API Lambda get
  `iam/siaga-config-read.json` (GetSecretValue on that one secret, GetParametersByPath on
  that one path). The tools and solver Lambdas get neither.
- **Environment of the deployed processes** (not secrets): `SECRETS_SOURCE=aws`,
  `FLAGS_SOURCE=ssm`, `AWS_REGION=ap-southeast-1`. They run on their IAM role: no access
  keys anywhere.
- **Output** `CaseApiUrl`: `scripts/fill-env.sh` reads it into `.env.aws`.
