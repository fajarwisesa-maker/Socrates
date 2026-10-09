// SIAGA authority tiers (build brief §2.3). Evaluated before every tool call.
// Locally with cedarpy (agent/policy.py); loaded into AgentCore Policy in Phase 7.
//
// The context is computed by deterministic code from the tool's arguments and SAP data,
// never by the LLM. `has_approval` is true only when a human approved exactly this
// action (tool + arguments) in the case store.
//
// Tier 0 Observe  - read-only tools and alerts (incl. raising an approval request)
// Tier 1 Draft    - drafts for human review (RFQ drafts)
// Tier 2 Execute  - reversible internal actions under Rp 50,000,000 (stock transfers)
// Tier 3 Escalate - >= Rp 50,000,000, any spot air, any customer SLA change, any new
//                   commitment to an external party: only with human approval.
// Anything not permitted below is denied (Cedar default deny).

@id("tier0-observe")
permit (principal == Agent::"siaga", action, resource)
when { context.observe_only };

@id("tier1-draft")
permit (principal == Agent::"siaga", action, resource)
when { context.draft_only && !context.external_commitment };

@id("tier2-execute")
permit (principal == Agent::"siaga", action, resource)
when { context.internal && context.reversible && context.amount_idr < 50000000 };

@id("tier3-approved")
permit (principal == Agent::"siaga", action, resource)
when { context.has_approval };

@id("tier3-amount")
forbid (principal, action, resource)
when { context.amount_idr >= 50000000 }
unless { context.has_approval };

@id("tier3-spot-air")
forbid (principal, action, resource)
when { context.spot_air }
unless { context.has_approval };

@id("tier3-sla-change")
forbid (principal, action, resource)
when { context.sla_change }
unless { context.has_approval };

@id("tier3-external-commitment")
forbid (principal, action, resource)
when { context.external_commitment }
unless { context.has_approval };
