"use client";

import { ArrowDown } from "lucide-react";
import type { CaseRecord, Config } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The v2 architecture (brief section 3) with the live path of this run highlighted. Built
 * only from /config: each box says what runs here today and what it becomes on AWS / SAP,
 * so Q&A answers stay accurate.
 */
interface Box {
  id: string;
  title: string;
  now: string;
  target?: string;
  live: boolean;
}

function boxes(config: Config | null, record: CaseRecord | null) {
  const b = config?.backends;
  const sap = config?.sap;
  const replay = !!config?.replay;
  const delay = config?.delay_model ?? "signal";
  const model = replay
    ? `replay of a recorded run (${config?.replay_source?.provider ?? "recording"})`
    : config?.llm_provider === "bedrock"
      ? `Amazon Bedrock · ${config.model ?? "model not set"}`
      : "scripted fake LLM (offline)";
  const top: Box[] = [
    { id: "dashboard", title: "SIAGA dashboard", now: "this page (Next.js)", live: true },
    {
      id: "joule",
      title: "SAP Joule",
      now: config?.joule_approvals ? "approvals from Joule" : "not in this build (step 4)",
      live: !!config?.joule_approvals,
    },
  ];
  const api: Box = {
    id: "api",
    title: "Case API",
    now: `FastAPI, local process${config?.pii_masking === "local" ? " · PII masked at intake" : ""}`,
    target: "API Gateway + Lambda",
    live: true,
  };
  const orchestrator: Box = {
    id: "orchestrator",
    title: "SIAGA Orchestrator",
    now: `deterministic supervisor: stage order, ${config?.max_tool_calls ?? 20}-call budget, ${
      config?.max_replans ?? 2
    } replans · model: ${model}`,
    target: "AgentCore Runtime",
    live: true,
  };
  const policy: Box = {
    id: "policy",
    title: "Gateway + Policy (Cedar tiers)",
    now: b?.policy === "agentcore" ? "AgentCore Policy" : "Cedar via cedarpy, in process",
    target: "AgentCore Gateway + Policy",
    live: true,
  };
  const tools: Box[] = [
    {
      id: "sap",
      title: "S/4HANA-style API",
      now:
        sap?.mode === "btp"
          ? `SAP BTP Cloud Foundry · ${sap.host ?? ""}`
          : sap?.mode === "embedded"
            ? "mock, in process"
            : `mock on ${sap?.host ?? "localhost"}`,
      target: "SAP BTP Cloud Foundry",
      live: true,
    },
    {
      id: "rpt",
      title: "SAP RPT-1.6 delay prediction",
      now:
        delay === "signal"
          ? "off: delay from the signals"
          : replay
            ? "replay of recorded answers"
            : delay === "rpt"
              ? "SAP AI Core"
              : "offline stand-in (not RPT)",
      target: "SAP AI Core",
      live: delay !== "signal" && record?.delay_prediction?.status !== "unavailable",
    },
    {
      id: "solver",
      title: "Solver (PuLP / CBC)",
      now: b?.solver === "lambda" ? "AWS Lambda" : b?.solver === "http" ? "HTTP service" : "in process",
      target: "AWS Lambda",
      live: true,
    },
    {
      id: "kb",
      title: "Precedent KB",
      now: b?.kb === "bedrock" ? "Bedrock Knowledge Base" : "BM25 over synthetic precedents, local",
      target: "Bedrock KB on S3 Vectors",
      live: true,
    },
    {
      id: "audit",
      title: "Audit writer",
      now: b?.audit === "s3" ? "S3 Object Lock" : "hash-chained JSONL, local",
      target: "S3 Object Lock",
      live: true,
    },
  ];
  return { top, api, orchestrator, policy, tools };
}

function Node({ box, children }: { box: Box; children?: React.ReactNode }) {
  return (
    <div
      data-testid={`arch-${box.id}`}
      data-live={box.live ? "1" : "0"}
      className={cn(
        "rounded-[var(--radius-control)] border-2 px-3 py-2",
        box.live ? "border-brand bg-brand-soft" : "border-dashed border-line bg-surface",
      )}
    >
      <div className={cn("text-sm font-semibold", box.live ? "text-brand-ink" : "text-ink-2")}>{box.title}</div>
      <div className="text-xs text-ink">
        <span className="text-ink-2">now: </span>
        {box.now}
      </div>
      {box.target && (
        <div className="text-xs text-ink-2">
          <span>target: </span>
          {box.target}
        </div>
      )}
      {children}
    </div>
  );
}

function Arrow({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-1 py-1 text-xs text-ink-2" aria-hidden>
      <ArrowDown className="size-4" />
      {label}
    </div>
  );
}

export default function ArchitectureView({ config, record }: { config: Config | null; record: CaseRecord | null }) {
  const { top, api, orchestrator, policy, tools } = boxes(config, record);
  const specialists = config?.orchestration === "multi" ? (config.specialists ?? []) : [];
  return (
    <div data-testid="architecture" className="space-y-1">
      <div className="mb-2 flex flex-wrap gap-3 text-xs text-ink-2">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-3 rounded-sm border-2 border-brand bg-brand-soft" /> in this run
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-3 rounded-sm border-2 border-dashed border-line bg-surface" /> not in
          this run
        </span>
        <span>“now” = what runs here today · “target” = the AWS / SAP service in the design</span>
      </div>
      <div className="text-xs font-semibold tracking-wide text-ink-2 uppercase">Planner (human in the loop)</div>
      <div className="grid grid-cols-2 gap-2">
        {top.map((b) => (
          <Node key={b.id} box={b} />
        ))}
      </div>
      <Arrow label="REST" />
      <Node box={api} />
      <Arrow />
      <Node box={orchestrator}>
        <div className="mt-2 flex flex-wrap gap-1.5" data-testid="arch-specialists">
          {specialists.length ? (
            specialists.map((sp) => (
              <span key={sp.name} className="rounded-md bg-surface px-2 py-0.5 text-xs ring-1 ring-brand/40">
                <b className="text-ink">{sp.name}</b>{" "}
                <span className="text-ink-2">({sp.stages.map((s) => s.toLowerCase()).join(" + ")})</span>
              </span>
            ))
          ) : (
            <span className="text-xs text-ink-2">v1 state machine: one model call path per stage (ORCHESTRATION=single)</span>
          )}
        </div>
      </Node>
      <Arrow label="every tool call" />
      <Node box={policy} />
      <Arrow />
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-5">
        {tools.map((b) => (
          <Node key={b.id} box={b} />
        ))}
      </div>
    </div>
  );
}
