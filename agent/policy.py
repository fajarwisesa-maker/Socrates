"""Policy engine: authorise every tool call against the Cedar tier policies.

`PolicyEngine` is the seam for Phase 7 (AgentCore Policy). The local implementation
evaluates `policy/*.cedar` with cedarpy. The schema's action list is generated from the
tool registry so that adding a tool never needs a hand edit of the schema.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from pathlib import Path
from typing import Protocol

import cedarpy
from pydantic import BaseModel

from siaga_common.settings import REPO_ROOT

POLICY_DIR = REPO_ROOT / "policy"
PRINCIPAL = 'Agent::"siaga"'


class PolicyContext(BaseModel):
    """Facts about one tool call, computed by code from the arguments and SAP data."""

    observe_only: bool = False
    draft_only: bool = False
    internal: bool = False
    reversible: bool = False
    external_commitment: bool = False
    spot_air: bool = False
    sla_change: bool = False
    amount_idr: int = 0
    has_approval: bool = False


class PolicyDecision(BaseModel):
    allowed: bool
    policies: list[str]  # @id of the policies that determined the decision
    errors: list[str] = []
    engine: str = "cedar-local"


class PolicyEngine(Protocol):
    def authorize(self, *, action: str, case_id: str, context: PolicyContext) -> PolicyDecision: ...


def _cedar_str(s: str) -> str:
    return json.dumps(s)  # Cedar string literal == JSON string literal for our ids


class LocalCedarPolicyEngine:
    def __init__(self, actions: Iterable[str], policy_dir: Path = POLICY_DIR):
        files = sorted(policy_dir.glob("*.cedar"))
        if not files:
            raise FileNotFoundError(f"no .cedar files in {policy_dir}")
        self.policies = "\n".join(f.read_text() for f in files)
        self.actions = sorted(set(actions))
        self.schema = (policy_dir / "siaga.cedarschema").read_text() + "".join(
            f"\naction {_cedar_str(a)} appliesTo "
            "{ principal: Agent, resource: Case, context: ToolContext };"
            for a in self.actions
        )
        self.ids = self._policy_ids()
        result = cedarpy.validate_policies(self.policies, self.schema)
        if not result.validation_passed:
            raise ValueError(f"Cedar policies do not validate: {result}")

    def _policy_ids(self) -> dict[str, str]:
        """Map cedarpy's positional ids (policy0, policy1, …) to @id annotations."""
        ids = re.findall(r'@id\("([^"]+)"\)\s*(?:permit|forbid)', self.policies)
        n = len(re.findall(r"^\s*(?:permit|forbid)\s*\(", self.policies, flags=re.M))
        if len(ids) != n:
            raise ValueError("every Cedar policy must carry exactly one @id annotation")
        return {f"policy{i}": pid for i, pid in enumerate(ids)}

    def authorize(self, *, action: str, case_id: str, context: PolicyContext) -> PolicyDecision:
        request = {
            "principal": PRINCIPAL,
            "action": f"Action::{_cedar_str(action)}",
            "resource": f"Case::{_cedar_str(case_id)}",
            "context": context.model_dump(),
        }
        r = cedarpy.is_authorized(request, self.policies, [], schema=self.schema)
        return PolicyDecision(
            allowed=r.decision == cedarpy.Decision.Allow,
            policies=[self.ids.get(p, p) for p in r.diagnostics.reasons],
            errors=[str(e) for e in r.diagnostics.errors],
        )
