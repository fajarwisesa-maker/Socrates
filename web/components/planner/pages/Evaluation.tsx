// Evaluation (mockup "Lab Evaluasi"): not built yet. It needs a read-only endpoint for the
// rehearse reports and the PERCEIVE eval result (docs/ui-v3-plan.md, step 8), so it shows
// what it will hold, without numbers.
import { FlaskConical, ListChecks, MessageSquareText } from "lucide-react";
import { Note, PageHeader, Panel } from "../ui";

export function Evaluation() {
  return (
    <div className="flex flex-col gap-6" data-testid="page-evaluation">
      <PageHeader
        chips={<FlaskConical className="size-5 text-sign-green" aria-hidden />}
        title="Evaluation"
        description="How well SIAGA reads signals and how reliably the demo runs."
      />
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="lg:col-span-6">
          <Panel title="Signal reading accuracy" icon={<MessageSquareText aria-hidden />} tone="info" testId="eval-perceive">
            <Note chip="Coming later">
              The PERCEIVE test set has 20 driver messages and notices (make eval-perceive). Its score shows here once the result
              is served by the Case API.
            </Note>
          </Panel>
        </div>
        <div className="lg:col-span-6">
          <Panel title="Rehearsal runs" icon={<ListChecks aria-hidden />} tone="info" testId="eval-rehearse">
            <Note chip="Coming later">
              make rehearse runs the demo end to end and records the pass rate and the time per stage. The latest report shows
              here once it is served by the Case API.
            </Note>
          </Panel>
        </div>
      </div>
    </div>
  );
}
