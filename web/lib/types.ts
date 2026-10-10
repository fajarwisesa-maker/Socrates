// Shapes returned by the Case API (see api/app.py). Only the fields the UI reads.

export type CaseStatus =
  | "OPEN"
  | "RUNNING"
  | "AWAITING_APPROVAL"
  | "VERIFYING"
  | "RESOLVED"
  | "REOPENED"
  | "ESCALATED"
  | "FAILED";

export type Stage = "PERCEIVE" | "ASSESS" | "PLAN" | "SIMULATE" | "REFLECT" | "ACT" | "VERIFY";
export const STAGES: Stage[] = ["PERCEIVE", "ASSESS", "PLAN", "SIMULATE", "REFLECT", "ACT", "VERIFY"];

export interface CaseEvent {
  case_id: string;
  seq: number;
  stage: Stage | "CASE";
  status: string;
  title: string;
  detail: string;
  data: Record<string, unknown>;
  ts: string;
}

export interface PlannedAction {
  kind: string;
  reference: string;
  quantity: number;
  trucks: number | null;
  cost: number;
  eta: string | null;
  dispatch_by: string | null;
}

export interface SolverResult {
  option_id: string;
  round: number;
  label: string;
  strategies: string[];
  constraints: { type: string; supplier?: string }[];
  total_cost_display: string;
  result: {
    status: "optimal" | "infeasible";
    total_cost: number;
    covered_quantity: number;
    required_quantity: number;
    actions: PlannedAction[];
    stock_after: { plant: string; on_hand_after: number; safety_stock: number }[];
    excluded: string[];
    infeasible_reason: string | null;
  };
}

export interface CriticFinding {
  option_id: string;
  round: number;
  clean: boolean;
  checks: { rule: string; passed: boolean; detail: string }[];
  tiers: { kind: string; reference: string; tool: string; tier: number; reasons: string[] }[];
}

export interface CaseAction {
  action_id: string;
  option_id: string;
  kind: string;
  description: string;
  tool: string;
  tier: number;
  quantity: number;
  cost: number;
  cost_display: string;
  eta: string | null;
  status: "PLANNED" | "EXECUTED" | "PENDING_APPROVAL" | "REJECTED" | "EXPIRED" | "FAILED";
  sap_ref?: string | null;
  approval_id?: string;
  rejection_reason?: string | null;
  card?: ApprovalCard;
}

export interface ApprovalCard {
  what: string;
  why: string;
  cost: number;
  cost_display: string;
  plan_total_display: string;
  tier_reasons: string[];
  alternatives: { option_id: string; label: string; total_cost_display: string }[];
  if_rejected: string;
  approve_by: string | null;
  approve_by_display: string;
  eta_display: string | null;
}

export interface Approval {
  approval_id: string;
  tool: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
  card: ApprovalCard;
  decided_by: string | null;
  decided_at: string | null;
  reason: string | null;
}

export interface RiskOrder {
  order: string;
  quantity: number;
  cutoff: string;
  penalty: number;
  stockout_probability: number;
  expected_exposure: number;
}

export interface Risk {
  usable_stock: number;
  demand: number;
  shortfall: number;
  deadline: string | null;
  orders: RiskOrder[];
  inbound: { ref: string; quantity: number; arrival_earliest: string; arrival_latest: string }[];
  max_exposure: number;
  expected_exposure: number;
}

export interface CaseRecord {
  case_id: string;
  status: CaseStatus;
  created_at: string;
  updated_at: string;
  day0: string | null;
  signals: { type: string; text: string; filename?: string }[];
  disruption: Disruption | null;
  affected: Affected | null;
  risk: Risk | null;
  candidates: Candidate[];
  solver_results: SolverResult[];
  critic_findings: CriticFinding[];
  actions: CaseAction[];
  notes: { tier: number; ref: string; text: string }[];
  tool_call_count: number;
  llm_call_count: number;
  replan_count: number;
  plan_round: number;
  stage: string | null;
  chosen_option: string | null;
  explanation: { summary: string; recommendation_rationale: string; risks: string[] } | null;
  summary: Summary | null;
  verification: Verification | null;
  verify_due_at: string | null;
  escalation_reason: string | null;
}

export interface Config {
  llm_provider: string;
  replay: boolean;
  model: string | null;
  verify_delay_seconds: number;
  max_tool_calls: number;
  max_replans: number;
  replay_source: { provider: string; model: string | null; recorded_at: string } | null;
}

export interface AuditEntry {
  seq: number;
  ts: string;
  kind: string;
  payload: AuditPayload;
  prev_hash: string;
  hash: string;
}

export interface Disruption {
  is_disruption: boolean;
  cause: string;
  lane: string | null;
  location: string | null;
  delay_hours_min: number | null;
  delay_hours_max: number | null;
  references: string[];
  confidence: "Low" | "Medium" | "High";
  evidence_quotes: string[];
}

export interface PurchaseOrderRow {
  PurchaseOrder: string;
  Supplier: string;
  items: { Material: string; Plant: string; OrderQuantity: number }[];
}

export interface SalesOrderRow {
  SalesOrder: string;
  YY1_SoldToPartyName: string;
  RequestedQuantity: number;
}

export interface Affected {
  material: string;
  plant: string;
  affected_references: string[];
  purchase_orders: PurchaseOrderRow[];
  sales_orders: SalesOrderRow[];
  stock: { OnHandQuantity: number; SafetyStockQuantity: number };
}

export interface Candidate {
  option_id: string;
  label: string;
  strategies: string[];
  rationale: string;
  round: number;
}

export interface Summary {
  chosen: string;
  chosen_cost: number;
  chosen_cost_display: string;
  max_exposure: number;
  max_exposure_display: string;
  expected_exposure: number;
  baseline?: string;
  baseline_cost_display?: string;
  saving_display?: string;
  saving_vs_baseline?: number;
  exposure_avoided: number;
  exposure_avoided_display: string;
  /** exposure avoided minus the chosen plan's cost, computed by the solver */
  net_protected: number;
  net_protected_display: string;
}

export interface Verification {
  checks: { ref: string; ok: boolean; quantity?: number; on_time?: boolean }[];
  projected_supply: number;
  demand: number;
  covered: boolean;
}

export interface AuditPayload {
  tool?: string;
  allowed?: boolean;
  tier?: number;
  policies?: string[];
  status?: string;
  approval_id?: string;
  from?: string | null;
  to?: string;
  purpose?: string;
  prompt?: string;
  model?: string;
  latency_s?: number;
  event?: string;
  by?: string;
}
