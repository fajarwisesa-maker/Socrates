// Gallery of the intentional error / guard-rail states (redesign step 5), rendered from
// fixture events through the same notices() the dashboard uses.
import { StateNotices } from "@/components/StateNotices";
import { Wordmark } from "@/components/presenter/Wordmark";
import { notices } from "@/lib/notices";
import type { CaseEvent, CaseRecord } from "@/lib/types";

const ts = "2026-10-30T07:00:00Z";
const ev = (seq: number, stage: CaseEvent["stage"], status: string, title: string, data: Record<string, unknown> = {}): CaseEvent => ({
  case_id: "case-demo",
  seq,
  stage,
  status,
  title,
  detail: "",
  data,
  ts,
});
const rec = (escalation_reason: string | null = null) =>
  ({ status: escalation_reason ? "ESCALATED" : "RUNNING", escalation_reason }) as unknown as CaseRecord;

const retry = (seq: number, attempt: number) =>
  ev(seq, "PERCEIVE", "retry", "Retrying the model call (throttled)", {
    reason: "throttled",
    attempt,
    max_attempts: 6,
    wait_s: 2,
  });

const CASES: { name: string; events: CaseEvent[]; record: CaseRecord; live: boolean }[] = [
  { name: "Throttled: retry in progress (neutral)", events: [retry(1, 2), retry(2, 3)], record: rec(), live: true },
  {
    name: "Throttled, then the call went through (Planner footnote)",
    events: [retry(1, 2), ev(2, "PERCEIVE", "llm", "LLM perceive (1.2 s)")],
    record: rec(),
    live: false,
  },
  {
    name: "Retries ran out: model unavailable (escalation)",
    events: [retry(1, 6), ev(2, "PERCEIVE", "escalated", "Escalated to a human planner")],
    record: rec("LLM unavailable: SAP AI Core HTTP 429 (throttled): rate exceeded after 6 attempts"),
    live: true,
  },
  {
    name: "Tool blocked by policy (guard rail working)",
    events: [
      ev(1, "ACT", "tool", "create_purchase_order -> denied (Tier 3)", {
        tool: "create_purchase_order",
        status: "denied",
        tier: 3,
        denial: {
          tier: 3,
          // the backend's denial wording (agent/tools/base.py)
          message: "Tier 3: new commitment to an external party. Escalate: request human approval for this exact action.",
          policies: ["tier3-external-commitment"],
        },
      }),
    ],
    record: rec(),
    live: true,
  },
  {
    name: "Tool-call budget used up (escalation)",
    events: [
      ev(1, "SIMULATE", "tool", "simulate_option -> budget_exceeded", {
        tool: "simulate_option",
        status: "budget_exceeded",
        error: "tool-call budget of 20 per case exhausted",
      }),
      ev(2, "SIMULATE", "escalated", "Escalated to a human planner"),
    ],
    record: rec("tool-call budget of 20 per case exhausted"),
    live: true,
  },
  {
    name: "Replan limit reached (escalation)",
    events: [ev(1, "ACT", "escalated", "Escalated to a human planner")],
    record: rec("planner rejected an action, and the replan limit (2) is reached"),
    live: true,
  },
];

export default function StatesPage() {
  return (
    <main className="mx-auto max-w-6xl space-y-8 p-10 text-ink" data-testid="states-gallery">
      <div className="flex items-center justify-between">
        <Wordmark />
        <span className="text-lg text-ink-2">Error and guard-rail states · redesign step 5</span>
      </div>
      <p className="max-w-3xl text-base text-ink-2">
        Neutral grey = the agent is coping (a retry). Red = a guard rail stopped something or the case went to a
        human. Each state says what happened in plain words; the raw reason stays in the detail line and the audit
        trail.
      </p>
      <div className="grid gap-6 lg:grid-cols-2">
        {CASES.map((c) => (
          <section key={c.name} className="space-y-3 rounded-2xl bg-surface p-5 shadow-[var(--shadow-card)]">
            <h2 className="text-sm font-semibold tracking-wide text-ink-2 uppercase">{c.name}</h2>
            <div className="text-[20px]">
              <StateNotices items={notices(c.events, c.record, c.live)} />
            </div>
            <div className="border-t-2 border-surface-2 pt-3">
              <div className="mb-1 text-xs text-ink-2">Planner size</div>
              <StateNotices size="planner" items={notices(c.events, c.record, c.live)} />
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
