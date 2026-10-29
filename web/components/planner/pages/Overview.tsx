"use client";

// Overview (mockup "Ringkasan"): the incident, four headline numbers, where the lane is
// blocked, the chosen plan against the baseline, the decisions and the latest activity.
import { AlertTriangle, ArrowRight, Boxes, Clock, FileWarning, Map as MapIcon, PackageX, Route, ShieldCheck, Sparkles } from "lucide-react";
import { Figure } from "@/components/Figure";
import { LaneMap } from "@/components/LaneMap";
import { Reveal } from "@/components/Reveal";
import { NoBreakCodes, SolverLabel } from "@/components/signs";
import { Button } from "@/components/ui/button";
import { actionChip, approvalTitle, disruptionPlace } from "@/lib/caseView";
import { dayShort, juta, thousands } from "@/lib/format";
import { laneModel } from "@/lib/laneModel";
import { useCountUp } from "@/lib/motion";
import type { Page } from "@/lib/page";
import { CAUSE, delay, plantName } from "@/lib/present";
import { STAGE_LABEL } from "@/lib/stages";
import type { CaseEvent, Stage } from "@/lib/types";
import { Chip, type ChipTone, Kpi, PageHeader, Panel, RowItem, Rows } from "../ui";
import type { CasePageProps } from "./types";

/** The page that needs the planner next, and the button's words. */
function nextStep(status: string): { page: Page; text: string } {
  if (status === "AWAITING_APPROVAL") return { page: "approvals", text: "Review the decision" };
  if (["VERIFYING", "RESOLVED", "REOPENED"].includes(status)) return { page: "verification", text: "See verification" };
  if (status === "ESCALATED") return { page: "audit", text: "See what happened" };
  return { page: "signals", text: "Follow the signals" };
}

/** Activity stage tags are tinted by what the event says happened. */
function eventTone(e: CaseEvent): ChipTone {
  if (["rejected", "failed", "escalated", "denied"].includes(e.status)) return "risk";
  if (["waiting", "approval", "scheduled"].includes(e.status)) return "needs";
  if (["completed", "executed"].includes(e.status)) return "ok";
  return "info";
}

export function Overview({ record, events, approvals, onPage }: CasePageProps) {
  const d = record.disruption;
  const risk = record.risk;
  const a = record.affected;
  const s = record.summary;
  const labels = a?.labels;
  const atRisk = risk?.orders.filter((o) => o.stockout_probability > 0) ?? [];
  const po = a?.purchase_orders[0];
  const exposure = useCountUp(risk?.max_exposure ?? null, juta, { id: `ov-${record.case_id}-exposure` });
  const view = ["VERIFYING", "RESOLVED", "REOPENED"].includes(record.status) ? "verify" : record.actions.length ? "act" : "assess";
  const model = laneModel(record, { kind: view });
  const chosen = record.solver_results.find((o) => o.option_id === record.chosen_option);
  const baseline = s?.baseline ? record.solver_results.find((o) => o.option_id === s.baseline) : null;
  const next = nextStep(record.status);
  const recent = events
    .filter((e) => e.stage !== "CASE" && ["completed", "info", "executed", "approval", "rejected", "scheduled", "waiting", "escalated"].includes(e.status))
    .slice(-6)
    .reverse();

  return (
    <div className="flex flex-col gap-6" data-testid="page-overview">
      <Reveal>
        <PageHeader
          chips={
            <>
              {d && <Chip tone="risk" icon={<AlertTriangle aria-hidden />}>{CAUSE[d.cause] ?? d.cause}</Chip>}
              {d?.confidence && <Chip tone="info">Confidence {d.confidence}</Chip>}
            </>
          }
          title="Overview"
          description={
            d
              ? `${CAUSE[d.cause] ?? "Disruption"} near ${disruptionPlace(record) || d.location || "the lane"}, delay ${delay(d.delay_hours_min, d.delay_hours_max)}. SIAGA reads the signals, prices the options and asks you only for what it may not do alone.`
              : "SIAGA is reading the signals."
          }
          actions={
            <Button onClick={() => onPage(next.page)} data-testid="overview-next">
              {next.text} <ArrowRight aria-hidden />
            </Button>
          }
        />
      </Reveal>

      <Reveal delay={50} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Inbound PO stuck"
          tone="info"
          icon={<PackageX aria-hidden />}
          value={a ? `${a.purchase_orders.length} PO` : "Not yet"}
          note={po ? `PO ${po.PurchaseOrder} · ${thousands(po.items[0]?.OrderQuantity)} ctn on the blocked lane` : "Assess reads SAP"}
          testId="kpi-po"
        />
        <Kpi
          label="Orders at risk"
          icon={<FileWarning aria-hidden />}
          tone={atRisk.length ? "risk" : "neutral"}
          value={risk ? `${atRisk.length} order${atRisk.length === 1 ? "" : "s"}` : "Not yet"}
          note={risk?.deadline ? `Loading cutoff ${dayShort(record.day0, risk.deadline)}` : undefined}
          testId="kpi-orders"
        />
        <Kpi
          label="Shortfall"
          tone={risk?.shortfall ? "needs" : "neutral"}
          icon={<Boxes aria-hidden />}
          value={risk ? `${thousands(risk.shortfall)} ctn` : "Not yet"}
          note={a && risk ? `${plantName(labels, a.plant)}: ${thousands(risk.usable_stock)} usable of ${thousands(risk.demand)} needed` : undefined}
          testId="kpi-shortfall"
        />
        <Kpi
          label="Penalty exposure"
          icon={<AlertTriangle aria-hidden />}
          tone="risk"
          value={risk ? <Figure shown={exposure ?? juta(risk.max_exposure)} final={juta(risk.max_exposure)} /> : "Not yet"}
          note={risk ? "If no order is saved · from the risk function" : undefined}
          testId="kpi-exposure"
        />
      </Reveal>

      <Reveal delay={100} className="grid gap-6 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-8">
          <Panel title="Where the lane is blocked" icon={<MapIcon aria-hidden />} tone="risk" description={model?.title}>
            {model ? <LaneMap model={model} key="map" /> : <p className="text-sm text-ink-2">The map appears once SAP is read.</p>}
          </Panel>
        </div>
        <div className="min-w-0 xl:col-span-4">
          <Panel
            title="Chosen plan"
            icon={<Route aria-hidden />}
            tone="ok"
            description={baseline ? "Against the baseline the solver priced" : undefined}
            testId="overview-plans"
            footer={
              s && risk ? (
                <>
                  <div className="flex items-baseline justify-between gap-4 text-sm">
                    <span className="text-ink-2">At risk</span>
                    <b className="text-base text-chip-risk-fg">{juta(risk.max_exposure)}</b>
                  </div>
                  <div className="flex items-baseline justify-between gap-4 text-sm">
                    <span className="text-ink-2">Protected (net)</span>
                    <b className="text-base text-chip-ok-fg">{juta(s.net_protected)}</b>
                  </div>
                  <SolverLabel />
                </>
              ) : undefined
            }
          >
            {chosen && s ? (
              <Rows>
                <RowItem tone="ok" className="flex-col gap-1">
                  <Chip tone="ok" icon={<Sparkles aria-hidden />}>
                    Chosen · {chosen.option_id}
                  </Chip>
                  <span className="text-2xl font-black whitespace-nowrap text-chip-ok-fg">{juta(s.case_cost ?? s.chosen_cost)}</span>
                  <span className="font-bold">{chosen.label}</span>
                  {s.saving_vs_baseline && s.saving_vs_baseline > 0 ? (
                    <span className="text-sm text-chip-ok-fg">Saves {juta(s.saving_vs_baseline)}</span>
                  ) : null}
                </RowItem>
                {baseline && (
                  <RowItem className="flex-col gap-1 px-4">
                    <Chip tone="muted">Baseline · {baseline.option_id}</Chip>
                    <span className="text-2xl font-black whitespace-nowrap text-ink-2">{juta(baseline.result.total_cost)}</span>
                    <span className="font-bold text-ink-2">{baseline.label}</span>
                  </RowItem>
                )}
              </Rows>
            ) : (
              <p className="text-sm text-ink-2">The solver prices the options after the plan.</p>
            )}
          </Panel>
        </div>
      </Reveal>

      <Reveal delay={150} className="grid gap-6 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-6">
          <Panel
            title="Decisions"
            icon={<ShieldCheck aria-hidden />}
            tone="needs"
            description="Tier 3 actions wait for you; Tier 2 SIAGA does alone."
            testId="overview-decisions"
            footer={
              <Button variant="link" className="self-start text-sm" onClick={() => onPage("approvals")}>
                Open approvals <ArrowRight aria-hidden />
              </Button>
            }
          >
            <Rows>
              {record.actions.length === 0 && <RowItem className="text-sm text-ink-2">No action yet.</RowItem>}
              {record.actions.map((x) => {
                const chip = actionChip(x, record, approvals);
                return (
                  <RowItem key={x.action_id} className="items-center">
                    <Chip tone="muted" className="shrink-0">
                      Tier {x.tier}
                    </Chip>
                    <span className="min-w-0 flex-1 text-sm font-bold">
                      <NoBreakCodes text={approvalTitle(x, record, x.description)} />
                    </span>
                    <span className="text-sm font-bold whitespace-nowrap">{juta(x.cost)}</span>
                    <Chip tone={chip.tone} className="shrink-0">
                      {chip.text}
                    </Chip>
                  </RowItem>
                );
              })}
            </Rows>
          </Panel>
        </div>
        <div className="min-w-0 lg:col-span-6">
          <Panel
            title="Latest activity"
            icon={<Clock aria-hidden />}
            tone="info"
            description="From the case's event stream"
            testId="overview-activity"
            footer={
              <Button variant="link" className="self-start text-sm" onClick={() => onPage("audit")}>
                Open the audit trail <ArrowRight aria-hidden />
              </Button>
            }
          >
            <Rows>
              {recent.map((e) => (
                <RowItem key={e.seq} className="text-sm">
                  <span className="w-16 shrink-0 pt-0.5 font-mono text-xs text-ink-2">{e.ts.slice(11, 19)}</span>
                  <Chip tone={eventTone(e)} className="shrink-0">
                    {STAGE_LABEL[e.stage as Stage] ?? e.stage}
                  </Chip>
                  <span className="min-w-0">{e.title}</span>
                </RowItem>
              ))}
            </Rows>
          </Panel>
        </div>
      </Reveal>
    </div>
  );
}
