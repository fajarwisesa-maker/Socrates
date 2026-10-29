import type { Page } from "@/lib/page";
import type { Approval, CaseEvent, CaseRecord, Config, Stage } from "@/lib/types";
import type { AuditData, InboxCase } from "@/lib/useInbox";

/** What every case page gets: the followed case, as polled by lib/useCase.ts. */
export interface CasePageProps {
  record: CaseRecord;
  events: CaseEvent[];
  approvals: Approval[];
  config: Config | null;
  audit: AuditData | null;
  agents: Partial<Record<Stage, string>>;
  onPage: (p: Page) => void;
  /** an approval was decided: refresh the case */
  onDecided: () => void;
}

export interface InboxProps {
  cases: InboxCase[];
  loaded: boolean;
  onOpen: (id: string) => void;
  onStarted: (id: string) => void;
  busy: boolean;
  onReset: () => void;
}
