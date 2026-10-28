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
  /** v2 (ORCHESTRATION=multi): the specialist working the stage, or the orchestrator */
  agent?: string | null;
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
  /** v2 Critic Agent: why the option fails, in plain language (model-written) */
  explanation?: string;
  checks: {
    rule: string;
    passed: boolean;
    detail: string;
    /** sentence built in code from the solver's numbers (never by the LLM) */
    plain?: string;
    facts?: Record<string, unknown>;
  }[];
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
  args?: Record<string, unknown>;
  planned?: PlannedAction & { lead_hours?: number };
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
  /** v2: two sentences written by the Executor Agent (model-written; numbers copied) */
  summary?: string;
  summary_by?: string;
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
  signals: {
    type: string;
    text: string;
    filename?: string;
    /** WhatsApp inbound: "whatsapp_api" when the message came in live; sender is masked */
    via?: string;
    sender?: string | null;
    received_at?: string | null;
  }[];
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
  /** v2 step 3 (DELAY_MODEL): the learned delay and how code combined it with the signal */
  delay_prediction?: DelayPrediction | null;
  /** v2 step 5 (PII_MASKING): what was masked before any model call */
  pii?: PiiReport | null;
}

export interface Config {
  llm_provider: string;
  replay: boolean;
  model: string | null;
  verify_delay_seconds: number;
  max_tool_calls: number;
  max_replans: number;
  replay_source: { provider: string; model: string | null; recorded_at: string } | null;
  /** v2: "single" (v1 state machine) or "multi" (specialist agents) */
  orchestration?: "single" | "multi";
  specialists?: Specialist[];
  /** v2: what each box of the architecture runs on (Architecture view) */
  delay_model?: "signal" | "rpt" | "fake";
  pii_masking?: "off" | "local";
  joule_approvals?: boolean;
  sap?: { mode: "local" | "embedded" | "btp"; host: string | null };
  backends?: { case_store: string; audit: string; kb: string; policy: string; solver: string };
  /** LLM_FALLBACK: a case may move to Claude via SAP AI Core when Bedrock refuses it */
  llm_fallback?: { provider: string; model: string } | null;
  /** WHATSAPP_INBOUND: cases can open from a WhatsApp message; the dashboard follows them */
  whatsapp_inbound?: boolean;
  /** WHATSAPP_NOTIFY: a finished WhatsApp case replies to its sender with the outcome */
  whatsapp_notify?: boolean;
  /** "meta" (Cloud API) or "twilio" (sandbox) */
  whatsapp_provider?: "meta" | "twilio";
}

export interface DelayPrediction {
  status: "ok" | "unavailable";
  provider?: string;
  model?: string;
  predicted_hours?: number;
  interval_hours?: [number, number] | null;
  history_rows?: number;
  used: "prediction" | "clamped" | "signal";
  delay_for_risk_hours: [number, number];
  signal_range_hours: [number, number];
  disagree: boolean;
  flag: string | null;
  reason?: string | null;
}

export interface PiiReport {
  mode: string;
  masked: number;
  kinds: Record<string, number>;
}

export interface Specialist {
  name: string;
  stages: Stage[];
  allowlist: string[];
  uses_llm_for: string;
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
  confidence_basis?: {
    corroborated_fields: string[];
    signals_with_evidence: number[];
    progression?: { up_to_signal: number; label: "Low" | "Medium" | "High" }[];
  };
  evidence_quotes: string[];
  /** quotes located in their signal by code (offsets into signals[signal - 1].text) */
  evidence?: Evidence[];
}

export interface Evidence {
  quote: string;
  signal: number;
  source: string;
  field: "is_disruption" | "cause" | "location" | "lane" | "delay" | "references";
  start: number;
  end: number;
  text: string;
  /** v2 Signal Agent: short English meaning of the quote (translation only) */
  gloss_en?: string | null;
}

export interface Labels {
  plants: Record<string, string | null>;
  suppliers: Record<string, { name: string | null; city: string | null; region: string | null; role: string | null }>;
  lanes: Record<string, { from: string | null; to: string | null; corridor: string | null; description: string | null }>;
}

export interface Precedent {
  id: string;
  title: string;
  period: string | null;
  synthetic: boolean;
}

export interface PurchaseOrderRow {
  PurchaseOrder: string;
  Supplier: string;
  YY1_TransportLane?: string | null;
  items: { Material: string; Plant: string; OrderQuantity: number }[];
}

export interface SalesOrderRow {
  SalesOrder: string;
  YY1_SoldToPartyName: string;
  YY1_Channel?: string;
  RequestedQuantity: number;
  YY1_PenaltyAmountIDR?: number;
}

export interface Affected {
  material: string;
  plant: string;
  affected_references: string[];
  purchase_orders: PurchaseOrderRow[];
  sales_orders: SalesOrderRow[];
  stock: { OnHandQuantity: number; SafetyStockQuantity: number };
  labels?: Labels;
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
  /** chosen plan + actions already executed in the case, computed by the solver */
  case_cost: number;
  case_cost_display: string;
  already_spent: number;
  already_spent_display: string;
  /** exposure avoided minus the case cost, computed by the solver */
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
  attempt?: number;
  max_attempts?: number;
  reason?: string;
  dropped?: unknown[];
  // v2: pii_masked, delay_prediction, allowlist_violation
  masked?: number;
  mode?: string;
  predicted_hours?: number;
  delay_for_risk_hours?: [number, number];
  used?: string;
  agent?: string;
}
