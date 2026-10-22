"""The five specialist agents: which stages they work, which tools they may call.

The allowlist is every tool the specialist may call, by its model or by its own code path
(the Executor's actions are calls of the chosen solver plan, made in code). A call outside
the allowlist is a hard error: audited, and the case is escalated.
"""

from __future__ import annotations

from dataclasses import dataclass

ORCHESTRATOR = "SIAGA Orchestrator"


@dataclass(frozen=True)
class Specialist:
    name: str
    key: str  # prompt file stem and LLM purpose prefix
    stages: tuple[str, ...]
    allowlist: frozenset[str]
    uses_llm_for: str


SIGNAL = Specialist(
    "Signal Agent",
    "signal",
    ("PERCEIVE",),
    frozenset({"extract_pdf_text"}),
    "reading slang, evidence quotes, English gloss",
)
IMPACT = Specialist(
    "Impact Agent",
    "impact",
    ("ASSESS",),
    frozenset({"find_open_pos", "get_sales_orders", "get_stock", "compute_risk"}),
    "choosing which lookups to run, explaining impact",
)
PLANNER = Specialist(
    "Planner Agent",
    "planner",
    ("PLAN", "SIMULATE"),
    frozenset({"search_precedents", "run_solver"}),
    "choosing strategy combinations, citing precedents",
)
CRITIC = Specialist(
    "Critic Agent",
    "critic",
    ("REFLECT",),
    frozenset({"check_business_rules"}),
    "explaining rule failures and the recommendation in plain language",
)
EXECUTOR = Specialist(
    "Executor Agent",
    "executor",
    ("ACT", "VERIFY"),
    # book_spot_air / reschedule_customer_order are not in the v2 brief's table; without
    # them a replan to air (after a rejected bridge PO) could not be executed.
    frozenset(
        {
            "create_stock_transfer",
            "request_approval",
            "create_purchase_order",
            "book_spot_air",
            "reschedule_customer_order",
            "check_status",
        }
    ),
    "writing the approval summary",
)

SPECIALISTS = (SIGNAL, IMPACT, PLANNER, CRITIC, EXECUTOR)
BY_STAGE = {stage: s for s in SPECIALISTS for stage in s.stages}
