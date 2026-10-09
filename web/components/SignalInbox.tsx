"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { Panel } from "./ui";

export default function SignalInbox({
  onStarted,
  disabled,
}: {
  onStarted: (caseId: string) => void;
  disabled: boolean;
}) {
  const [text, setText] = useState("");
  const [pdf, setPdf] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function loadDemoText() {
    setText(await api.demoWhatsapp());
  }
  async function loadDemoPdf() {
    const blob = await api.demoPdf();
    setPdf(new File([blob], "forwarder_notice.pdf", { type: "application/pdf" }));
  }
  async function start() {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      if (text.trim()) form.append("whatsapp", text);
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
    <Panel title="Signal inbox" testId="signal-inbox">
      <div className="space-y-3">
        <div className="flex gap-2">
          <button
            onClick={loadDemoText}
            className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50"
          >
            Load demo WhatsApp
          </button>
          <button
            onClick={loadDemoPdf}
            className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50"
          >
            Load forwarder PDF
          </button>
        </div>
        <label className="block">
          <span className="text-xs font-medium text-slate-600">WhatsApp message (driver)</span>
          <textarea
            data-testid="whatsapp-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            lang="id"
            placeholder="Paste the WhatsApp message here…"
            className="mt-1 w-full rounded-md border border-slate-300 bg-emerald-50/40 p-2 text-sm italic text-slate-800 focus:border-sky-500 focus:outline-none"
          />
        </label>
        <div>
          <span className="text-xs font-medium text-slate-600">Forwarder notice (PDF)</span>
          <div className="mt-1 flex items-center gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50"
            >
              Choose PDF
            </button>
            <span data-testid="pdf-name" className="truncate text-xs text-slate-600">
              {pdf ? pdf.name : "no file"}
            </span>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => setPdf(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>
        <button
          data-testid="start-case"
          onClick={start}
          disabled={busy || disabled || (!text.trim() && !pdf)}
          className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Starting…" : "Start case"}
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </Panel>
  );
}
