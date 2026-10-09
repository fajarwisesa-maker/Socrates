"""Wire the agent's dependencies from settings (local now; AWS backends in Phase 7)."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime

from agent.audit import AuditWriter, LocalAuditWriter
from agent.case_store import CaseStore, SqliteCaseStore
from agent.clients import HttpSapClient, HttpSolver, InProcessSolver, SapClient, SolverClient
from agent.kb import LocalBM25KB, PrecedentKB
from agent.policy import LocalCedarPolicyEngine, PolicyEngine
from agent.tools.base import ToolContext, ToolRegistry
from agent.tools.catalog import build_registry
from siaga_common.settings import Settings, get_settings


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
        )


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
) -> Runtime:
    s = settings or get_settings()
    clock = clock or (lambda: datetime.now(UTC))
    registry = build_registry()

    if solver is None:
        if s.solver_backend == "inprocess":
            solver = InProcessSolver()
        elif s.solver_backend == "http":
            solver = HttpSolver(s.solver_url)
        else:
            _phase7("Lambda solver")
    if store is None:
        store = (
            SqliteCaseStore(s.sqlite_path, clock)
            if s.case_store == "sqlite"
            else _phase7("DynamoDB case store")
        )
    if audit is None:
        audit = (
            LocalAuditWriter(s.audit_dir, clock)
            if s.audit_backend == "local"
            else _phase7("S3 audit")
        )
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
        sap=sap or HttpSapClient(s.sap_mock_url),
        solver=solver,
        store=store,
        audit=audit,
        policy=policy,
        kb=kb,
        registry=registry,
        clock=clock,
    )
