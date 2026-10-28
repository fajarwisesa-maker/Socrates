"""Wire the agent's dependencies from settings (local, or AWS: S3 audit, Lambda solver)."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime

from agent.audit import AuditWriter, LocalAuditWriter, S3AuditWriter
from agent.case_store import CaseStore, SqliteCaseStore
from agent.clients import (
    HttpSapClient,
    HttpSolver,
    InProcessSolver,
    LambdaSolver,
    SapClient,
    SolverClient,
)
from agent.delay_model import DelayPredictor, make_delay_model
from agent.kb import LocalBM25KB, PrecedentKB
from agent.policy import LocalCedarPolicyEngine, PolicyEngine
from agent.tools.base import ToolContext, ToolRegistry
from agent.tools.catalog import build_registry
from siaga_common.settings import Settings, export_aws_env, get_settings


def _phase7(what: str):
    raise NotImplementedError(f"{what} backend arrives in Phase 7")


@dataclass
class Runtime:
    settings: Settings
    sap: SapClient
    solver: SolverClient
    store: CaseStore
    audit: AuditWriter
    policy: PolicyEngine
    kb: PrecedentKB
    registry: ToolRegistry
    clock: Callable[[], datetime] = field(default=lambda: datetime.now(UTC))
    delay_model: DelayPredictor | None = None  # v2 step 3 (DELAY_MODEL)

    def context(self, case_id: str) -> ToolContext:
        return ToolContext(
            case_id=case_id,
            sap=self.sap,
            solver=self.solver,
            store=self.store,
            audit=self.audit,
            policy=self.policy,
            kb=self.kb,
            clock=self.clock,
            max_tool_calls=self.settings.max_tool_calls,
            delay_model=self.delay_model,
        )


def _sap_endpoint(s: Settings) -> tuple[str, None, dict[str, str]]:
    url, headers = s.sap_endpoint()
    return url, None, headers


def build_runtime(
    settings: Settings | None = None,
    *,
    sap: SapClient | None = None,
    solver: SolverClient | None = None,
    store: CaseStore | None = None,
    audit: AuditWriter | None = None,
    policy: PolicyEngine | None = None,
    kb: PrecedentKB | None = None,
    clock: Callable[[], datetime] | None = None,
    delay_model: DelayPredictor | None = None,
) -> Runtime:
    s = settings or get_settings()
    clock = clock or (lambda: datetime.now(UTC))
    registry = build_registry(multi=s.orchestration == "multi", delay=s.delay_model != "signal")

    if solver is None:
        if s.solver_backend == "inprocess":
            solver = InProcessSolver()
        elif s.solver_backend == "http":
            solver = HttpSolver(s.solver_url)
        else:
            export_aws_env()  # AWS_PROFILE etc. from .env reach boto3
            solver = LambdaSolver(
                s.solver_lambda_name,
                region=s.aws_region,
                fallback=InProcessSolver() if s.solver_lambda_fallback else None,
            )
    if store is None:
        store = (
            SqliteCaseStore(s.sqlite_path, clock)
            if s.case_store == "sqlite"
            else _phase7("DynamoDB case store")
        )
    if audit is None:
        audit = LocalAuditWriter(s.audit_dir, clock)
        if s.audit_backend == "s3":
            if not s.audit_s3_bucket:
                raise RuntimeError("AUDIT_BACKEND=s3 needs AUDIT_S3_BUCKET (make aws-setup)")
            export_aws_env()
            audit = S3AuditWriter(audit, s.audit_s3_bucket, s.audit_s3_prefix,
                                  region=s.aws_region)  # fmt: skip
    if policy is None:
        policy = (
            LocalCedarPolicyEngine(registry.names())
            if s.policy_backend == "local"
            else _phase7("AgentCore Policy")
        )
    if kb is None:
        kb = LocalBM25KB() if s.kb_backend == "local" else _phase7("Bedrock Knowledge Base")
    return Runtime(
        settings=s,
        sap=sap or HttpSapClient(*_sap_endpoint(s)),
        solver=solver,
        store=store,
        audit=audit,
        policy=policy,
        kb=kb,
        registry=registry,
        clock=clock,
        delay_model=delay_model if delay_model is not None else make_delay_model(s),
    )
