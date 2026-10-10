"use client";

import { Check, FileText, MessageCircle, Play } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

/** Before a case: load the two demo signals and start. Replaces the signal inbox. */
export function StartCanvas({ onStarted }: { onStarted: (caseId: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  const [pdf, setPdf] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      if (text?.trim()) form.append("whatsapp", text);
      if (pdf) form.append("pdf", pdf);
      const { case_id } = await api.startCase(form);
      onStarted(case_id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col" data-testid="start-canvas">
      <p className="text-xl font-medium text-brand-ink">New disruption signal</p>
      <h1 className="mt-1 text-[2.5rem] leading-tight font-bold tracking-tight">Waiting for a signal</h1>
      <p className="mt-2 text-xl text-ink-2">A driver’s WhatsApp and the forwarder’s notice just came in.</p>

      <div className="mt-8 grid grid-cols-2 gap-4">
        <SourceButton
          icon={<MessageCircle aria-hidden />}
          title="Driver WhatsApp"
          loaded={!!text}
          onClick={async () => setText(await api.demoWhatsapp())}
          testId="load-whatsapp"
        />
        <SourceButton
          icon={<FileText aria-hidden />}
          title="Forwarder PDF"
          loaded={!!pdf}
          onClick={async () => {
            const blob = await api.demoPdf();
            setPdf(new File([blob], "forwarder_notice.pdf", { type: "application/pdf" }));
          }}
          testId="load-pdf"
        />
      </div>

      <div className="mt-auto flex items-center gap-4 pt-8">
        <Button size="xl" onClick={start} disabled={busy || (!text && !pdf)} data-testid="presenter-start">
          <Play aria-hidden /> {busy ? "Starting…" : "Start case"}
        </Button>
        {error && <span className="text-xl text-risk-ink">{error}</span>}
      </div>
    </div>
  );
}

function SourceButton({
  icon,
  title,
  loaded,
  onClick,
  testId,
}: {
  icon: React.ReactNode;
  title: string;
  loaded: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className={
        "flex items-center gap-4 rounded-[var(--radius-card)] border-2 p-5 text-left text-xl font-semibold transition-colors [&_svg]:size-8 " +
        (loaded ? "border-brand bg-brand-soft text-brand-ink" : "border-line bg-surface text-ink hover:bg-surface-2")
      }
    >
      {icon}
      <span className="flex-1">{title}</span>
      {loaded ? <Check className="text-brand" aria-label="loaded" /> : <span className="text-lg text-ink-2">Load</span>}
    </button>
  );
}
