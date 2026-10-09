import type { Approval, AuditEntry, CaseEvent, CaseRecord, Config } from "./types";

const BASE = "/api";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? JSON.stringify(body);
    } catch {}
    throw new Error(`${res.status} ${detail}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  config: () => fetch(`${BASE}/config`, { cache: "no-store" }).then(json<Config>),
  startCase: (form: FormData) =>
    fetch(`${BASE}/cases`, { method: "POST", body: form }).then(json<{ case_id: string }>),
  listCases: () =>
    fetch(`${BASE}/cases`, { cache: "no-store" }).then(
      json<{ cases: { case_id: string; status: string; created_at: string }[] }>,
    ),
  getCase: (id: string) =>
    fetch(`${BASE}/cases/${id}`, { cache: "no-store" }).then(
      json<{ case: CaseRecord; approvals: Approval[] }>,
    ),
  events: (id: string, after: number) =>
    fetch(`${BASE}/cases/${id}/events?after=${after}`, { cache: "no-store" }).then(
      json<{ events: CaseEvent[]; last_seq: number }>,
    ),
  audit: (id: string) =>
    fetch(`${BASE}/cases/${id}/audit`, { cache: "no-store" }).then(
      json<{
        entries: AuditEntry[];
        verification: { ok: boolean; entries: number; broken_at: number | null; reason: string | null };
      }>,
    ),
  decide: (id: string, approvalId: string, decision: "approve" | "reject", reason?: string) =>
    fetch(`${BASE}/cases/${id}/approvals/${approvalId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, reason: reason || null, by: "planner" }),
    }).then(json),
  reset: () => fetch(`${BASE}/demo/reset`, { method: "POST" }).then(json<{ sap: { day0: string } }>),
  demoWhatsapp: () => fetch(`${BASE}/demo/inputs/whatsapp`).then((r) => r.text()),
  demoPdf: () => fetch(`${BASE}/demo/inputs/pdf`).then((r) => r.blob()),
};
