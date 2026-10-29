"use client";

// Overview (mockup "Ringkasan"): the incident, four headline numbers, where the lane is
// blocked, the chosen plan against the baseline, the decisions and the latest activity.
import { AlertTriangle, ArrowRight, Boxes, Clock, FileWarning, Map as MapIcon, PackageX, Route, ShieldCheck, Sparkles } from "lucide-react";
import { Figure } from "@/components/Figure";
import { LaneMap } from "@/components/LaneMap";
import { Reveal } from "@/components/Reveal";
import { SolverLabel } from "@/components/signs";
import { Button } from "@/components/ui/button";
import { actionFor, approvalTitle, disruptionPlace } from "@/lib/caseView";
import { dayShort, juta, thousands } from "@/lib/format";
import { laneModel } from "@/lib/laneModel";
import { useCountUp } from "@/lib/motion";
import type { Page } from "@/lib/page";
import { CAUSE, delay, plantName } from "@/lib/present";
import { STAGE_LABEL } from "@/lib/stages";
import type { Stage } from "@/lib/types";
import { Chip, Kpi, PageHeader, Panel } from "../ui";
import type { CasePageProps } from "./types";

/** The page that needs the planner next, and the button's words. */
function nextStep(status: string): { page: Page; text: string } {
  if (status === "AWAITING_APPROVAL") return { page: "approvals", text: "Review the decision" };
  if (["VERIFYING", "RESOLVED", "REOPENED"].includes(status)) return { page: "verification", text: "See verification" };
  if (status === "ESCALATED") return { page: "audit", text: "See what happened" };
  return { page: "signals", text: "Follow the signals" };
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
  const recent = events.filter((e) => e.stage !== "CASE" && ["completed", "info", "executed", "approval", "rejected", "scheduled"].includes(e.status)).slice(-6).reverse();

  return (
    <div className="flex flex-col gap-8" data-testid="page-overview">
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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Reveal>
          <Kpi
            label="Inbound PO stuck"
            icon={<PackageX aria-hidden />}
            value={a ? `${a.purchase_orders.length} PO` : "Not yet"}
            note={po ? `PO ${po.PurchaseOrder} · ${thousands(po.items[0]?.OrderQuantity)} ctn on the blocked lane` : "Assess reads SAP"}
            testId="kpi-po"
          />
        </Reveal>
        <Reveal delay={70}>
          <Kpi
            label="Orders at risk"
            icon={<FileWarning aria-hidden />}
            tone={atRisk.length ? "risk" : "neutral"}
            value={risk ? `${atRisk.length} order${atRisk.length === 1 ? "" : "s"}` : "Not yet"}
            note={risk?.deadline ? `Loading cutoff ${dayShort(record.day0, risk.deadline)}` : undefined}
            testId="kpi-orders"
          />
        </Reveal>
        <Reveal delay={140}>
          <Kpi
            label="Shortfall"
            icon={<Boxes aria-hidden />}
            value={risk ? `${thousands(risk.shortfall)} ctn` : "Not yet"}
            note={a && risk ? `${plantName(labels, a.plant)}: ${thousands(risk.usable_stock)} usable of ${thousands(risk.demand)} needed` : undefined}
            testId="kpi-shortfall"
          />
        </Reveal>
        <Reveal delay={210}>
          <Kpi
            label="Penalty exposure"
            icon={<AlertTriangle aria-hidden />}
            tone="risk"
            value={risk ? <Figure shown={exposure ?? juta(risk.max_exposure)} final={juta(risk.max_exposure)} /> : "Not yet"}
            note={risk ? "If no order is saved · from the risk function" : undefined}
            testId="kpi-exposure"
          />
        </Reveal>
      </div>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel title="Where the lane is blocked" icon={<MapIcon aria-hidden />} description={model?.title}>
          {model ? <LaneMap model={model} key="map" /> : <p className="text-sm text-ink-2">The map appears once SAP is read.</p>}
        </Panel>

        <Panel
          title="Chosen plan against the baseline"
          icon={<Route aria-hidden />}
          right={s?.saving_vs_baseline && s.saving_vs_baseline > 0 ? <Chip tone="ok">Saves {juta(s.saving_vs_baseline)}</Chip> : undefined}
          testId="overview-plans"
        >
          {chosen && s ? (
            <div className="flex flex-col gap-4">
              <div className="rounded-[12px] bg-brand-soft p-4">
                <div className="flex items-center justify-between gap-2">
                  <Chip tone="ok" icon={<Sparkles aria-hidden />}>
                    Chosen · option {chosen.option_id}
                  </Chip>
                  <span className="text-2xl font-black text-brand-ink">{juta(s.case_cost ?? s.chosen_cost)}</span>
                </div>
                <p className="mt-2 font-bold">{chosen.label}</p>
              </div>
              {baseline && (
                <div className="rounded-[12px] bg-surface-2 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <Chip tone="muted">Baseline · option {baseline.option_id}</Chip>
                    <span className="text-2xl font-black text-ink-2">{juta(baseline.result.total_cost)}</span>
                  </div>
                  <p className="mt-2 font-bold text-ink-2">{baseline.label}</p>
                </div>
              )}
              <SolverLabel />
            </div>
          ) : (
            <p className="text-sm text-ink-2">The solver prices the options after the plan.</p>
          )}
        </Panel>
      </div>

      <div className="grid gap-8 xl:grid-cols-2">
        <Panel title="Decisions" icon={<ShieldCheck aria-hidden />} description="Tier 3 actions wait for you; Tier 2 SIAGA does alone." testId="overview-decisions">
          <ul className="flex flex-col gap-2">
            {record.actions.length === 0 && <li className="text-sm text-ink-2">No action yet.</li>}
            {record.actions.map((x) => {
              const ap = approvals.find((p) => p.approval_id === x.approval_id);
              const tone = x.status === "EXECUTED" ? "ok" : x.status === "PENDING_APPROVAL" ? "needs" : x.status === "REJECTED" || x.status === "EXPIRED" || x.status === "WITHDRAWN" ? "risk" : "muted";
              const text = x.status === "EXECUTED" ? (x.tier >= 3 ? "Approved · done" : "Done by SIAGA") : x.status === "PENDING_APPROVAL" ? "Needs you" : x.status === "REJECTED" ? "Rejected" : x.status === "EXPIRED" ? "Too late" : x.status === "WITHDRAWN" ? "Withdrawn" : x.status.toLowerCase();
              return (
                <li key={x.action_id} className="flex items-center gap-4 border-b border-divider py-2 last:border-0">
                  <Chip tone="muted">Tier {x.tier}</Chip>
                  <span className="min-w-0 flex-1 truncate text-sm font-bold">
                    {ap ? approvalTitle(actionFor(ap, record), record, ap.card.what) : x.description}
                  </span>
                  <span className="text-sm font-bold whitespace-nowrap">{juta(x.cost)}</span>
                  <Chip tone={tone}>{text}</Chip>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel title="Latest activity" icon={<Clock aria-hidden />} description="From the case's event stream" testId="overview-activity">
          <ol className="flex flex-col gap-2">
            {recent.map((e) => (
              <li key={e.seq} className="flex items-start gap-4 text-sm">
                <span className="w-16 shrink-0 font-mono text-xs text-ink-2">{e.ts.slice(11, 19)}</span>
                <Chip tone="muted" className="shrink-0">
                  {STAGE_LABEL[e.stage as Stage] ?? e.stage}
                </Chip>
                <span className="min-w-0">{e.title}</span>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </div>
  );
}
