# Phase 7 — AWS design note (for approval)

Status: **proposal, nothing built yet.** Region `ap-southeast-1` (Singapore).

## 1. IaC tool: AWS CDK in Python

CDK (Python) rather than SAM. The codebase is Python, so the stacks can import the same
settings and tool registry (e.g. to generate the Gateway tool schemas from `Tool.spec()`).
CDK has L1 constructs for every piece we need (`aws_bedrockagentcore` incl.
`CfnPolicyEngine`, `aws_s3vectors`, `aws_bedrock.CfnKnowledgeBase` with
`S3VectorsConfiguration`) plus an alpha L2 for AgentCore. SAM's strength is Lambda +
API Gateway; it would leave AgentCore, S3 Vectors and the Knowledge Base as raw
CloudFormation anyway. Container images (solver, agent) are built by CDK
`DockerImageAsset`s, so the deploy machine needs Docker. `make deploy` / `make destroy`
wrap `cdk deploy` / `cdk destroy`.

## 2. Architecture

```
laptop: Next.js dashboard ──/api proxy (adds bearer token)──▶ API Gateway (HTTP API)
                                                               │  Lambda authorizer (token)
                                                               ▼
                                         Case API Lambda (FastAPI + Mangum, same api/app.py)
                                           │ sync: reads/writes DynamoDB (cases, events, approvals)
                                           │ async self-invoke for jobs (run / decide+verify)
                                           ▼
                                   InvokeAgentRuntime ──▶ AgentCore Runtime (agent container, ARM64)
                                                            │ LLM: Bedrock Converse (Claude)
                                                            │ tools: MCP ──▶ AgentCore Gateway (AWS_IAM auth)
                                                            │                 │ AgentCore Policy (ENFORCE)
                                                            │                 ▼
                                                            │           Tools Lambda (same Tool classes,
                                                            │           in-code tier guard)
                                                            │            ├─ mock SAP API (API GW + Lambda/Mangum,
                                                            │            │   DynamoDB single table, IAM auth)
                                                            │            ├─ Solver Lambda (container, ARM64, PuLP/CBC)
                                                            │            └─ Bedrock Knowledge Base (S3 Vectors)
                                                            └─ audit ──▶ S3 Object Lock bucket (governance)
```

| Piece | AWS service | Notes |
| --- | --- | --- |
| Agent | AgentCore Runtime | container (ARM64, port 8080, `/invocations` + `/ping`) wrapping `agent/machine.py`; ops `run`, `decide`, `verify` |
| Tools | AgentCore Gateway, Lambda target | one target `siaga-tools`; tool name arrives as `siaga-tools___<tool>`; the Lambda runs the existing `Tool` classes incl. `guard()` |
| Policy | AgentCore Policy, `ENFORCE` mode | see §3 — needs your OK |
| Solver | Lambda container image, ARM64 | PuLP 2.9 bundles a linux/arm64 CBC; same `lambda_handler.py` (direct invoke) |
| Mock S/4HANA | API Gateway + Lambda (Mangum), DynamoDB | `DynamoSapStore` implements `SapStore`; transfers/POs use `TransactWriteItems`; number ranges are atomic counters |
| Case store + events | DynamoDB (on-demand) | `DynamoCaseStore` implements `CaseStore`; event `seq` from an atomic counter on the case item |
| Precedent KB | Bedrock Knowledge Base on S3 Vectors | precedents uploaded to S3, ingestion job at deploy; `search_precedents` calls `Retrieve` |
| Audit | S3 with Object Lock, governance mode | one object per entry (`audit/<case>/<seq>.json`); the hash chain is unchanged; `verify()` lists and re-hashes |
| Case API | API Gateway HTTP API + Lambda | Lambda can't keep background threads, so jobs are async self-invocations that call `InvokeAgentRuntime`; after an approval the job waits `VERIFY_DELAY_SECONDS` and then runs VERIFY (no scheduler service needed for a 60 s delay) |
| Frontend | **local on the demo laptop** (recommended) | `SIAGA_API_URL` = API Gateway URL; works offline-first, no extra hosting; the existing `/api` proxy becomes a small route handler that adds the bearer token |
| Guard rails | AWS Budgets alarm, CloudWatch logs (7-day retention) | `make destroy` empties buckets (Object Lock governance objects deleted with `BypassGovernanceRetention`) and deletes the stacks |

Code changes stay behind the existing seams (`CASE_STORE=dynamodb`, `AUDIT_BACKEND=s3`,
`KB_BACKEND=bedrock`, `POLICY_BACKEND=agentcore`, `SOLVER_BACKEND=lambda`); agent logic
does not change. The same `make rehearse` runs against AWS by pointing `CASE_API_URL` at
API Gateway (plus the token).

## 3. Deviation that needs your OK: how the Cedar policies run in AgentCore Policy

The brief says the same `.cedar` files are loaded into AgentCore Policy. They can't be,
verbatim. AgentCore Policy evaluates a tool call on **the tool's input arguments and the
caller's OAuth/IAM identity**, against a Cedar schema it generates from the Gateway's tool
input schemas (principal = caller, action = `AgentCore::Action::"<target>___<tool>"`,
resource = the gateway ARN, tool arguments under `context.input`). Our local policy
evaluates *derived facts* (`amount_idr`, `internal`, `reversible`, `has_approval`, …) that
code computes from SAP data and the approval store.

Proposal:
1. Action tools get one extra input object, `policy_facts`, filled by the agent's code
   (never by the LLM) from the same `policy_context()` it uses today.
2. A small generator turns `policy/siaga.cedar` into `policy/agentcore/siaga.cedar`
   (same rules; entity/action names and `context.input.policy_facts.*` paths adapted). One
   source of truth; a test evaluates both versions on the same 768×3 fact combinations.
3. The tools Lambda **ignores** `policy_facts` and recomputes everything from SAP and the
   approval table in `guard()`, so a forged `policy_facts` can't widen anything. The
   authoritative check stays in code; AgentCore Policy is the outer layer.

Alternative if you prefer: keep the local cedarpy check inside the tools Lambda and use
AgentCore Policy only for coarse rules (e.g. "action tools only for the agent's role").

## 4. Verified vs not yet verified

The build container can't reach docs.aws.amazon.com (network policy), so I checked the AWS
API models shipped in botocore 1.43 and searched for the rest.

- Verified in the botocore API model: `CreatePolicyEngine`, `CreatePolicy` (Cedar statement,
  `ENFORCE`/`LOG_ONLY`, validation against the schema generated from the Gateway tools'
  input schemas), `CreateGateway` (`policyEngineConfiguration`, authorizer `AWS_IAM`, MCP).
- From AWS pages found by search: Policy GA (March 2026) lists Singapore; S3 Vectors GA
  (Dec 2025) lists Singapore; CloudFormation has `AWS::BedrockAgentCore::PolicyEngine`,
  `AWS::S3Vectors::VectorBucket` and `S3VectorsConfiguration` for knowledge bases; the
  Gateway Lambda-target tool-name format; the Runtime container contract.
- **Not yet verified, checked at the start of the build:** Runtime and Gateway availability in
  Singapore from an AWS page (only third-party so far); whether CloudFormation has an
  `AWS::BedrockAgentCore::Policy` resource (fallback: a custom resource calling
  `CreatePolicy`); Runtime session/idle limits; which embeddings model is available for the
  Knowledge Base in Singapore; current Bedrock prices for the cost estimate.

## 5. Rough cost per day (to confirm with the pricing pages)

Dominated by Bedrock tokens: a demo run is ~8 model calls (~25k input, ~4k output
tokens). At current Sonnet-class prices that is cents per run, so 100 rehearsal runs a
day is single-digit dollars. Everything else is on-demand and small at demo volume
(Lambda, API Gateway, DynamoDB, S3, Gateway calls, Runtime compute while a case runs, KB
retrievals, logs): expected well under USD 5/day. Idle cost is near zero except S3 storage.
Budget alarm proposed at **USD 50/month** (your call).

## 6. What I need from you

1. OK on CDK Python (§1) and on the policy approach in §3 (or the alternative).
2. OK on the local frontend (§2).
3. Budget alarm amount and email; S3 Object Lock retention (proposal: 1 day, governance).
4. The AWS access from the setup list (credentials in the environment, deploy rights, Bedrock
   model + embeddings model access, Docker on the deploy machine).

## Sources

- [Policy in Amazon Bedrock AgentCore is now generally available](https://aws.amazon.com/about-aws/whats-new/2026/03/policy-amazon-bedrock-agentcore-generally-available/)
- [Getting started with Policy in AgentCore](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy-getting-started.html)
- [Policy scope (Cedar in AgentCore)](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy-understanding-cedar.html)
- [AWS Lambda function targets (Gateway)](https://docs.aws.amazon.com/ja_jp/bedrock-agentcore/latest/devguide/gateway-add-target-lambda.html)
- [AgentCore Runtime service contract](https://docs.aws.amazon.com/es_es/bedrock-agentcore/latest/devguide/runtime-service-contract.html)
- [AgentCore VPC configuration (regions)](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agentcore-vpc.html)
- [Amazon S3 Vectors now generally available](https://aws.amazon.com/blogs/aws/amazon-s3-vectors-now-generally-available-with-increased-scale-and-performance/)
- [S3 Vectors expands to 17 additional Regions](https://aws.amazon.com/about-aws/whats-new/2026/03/s3-vectors-expands-17-regions)
- [Prerequisites for a knowledge base vector store](https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base-setup.html)
- [AWS::BedrockAgentCore::PolicyEngine](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-bedrockagentcore-policyengine.html)
- [AWS::S3Vectors::VectorBucket](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-s3vectors-vectorbucket.html)
- [AWS::Bedrock::KnowledgeBase S3VectorsConfiguration](https://docs.aws.amazon.com/ko_kr/AWSCloudFormation/latest/TemplateReference/aws-properties-bedrock-knowledgebase-s3vectorsconfiguration.html)
- [CDK Python `aws_bedrockagentcore.CfnPolicyEngine`](https://docs.aws.amazon.com/cdk/api/v2/python/aws_cdk.aws_bedrockagentcore/CfnPolicyEngine.html)
