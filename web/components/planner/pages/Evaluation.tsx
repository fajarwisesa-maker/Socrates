// Evaluation (mockup "Lab Evaluasi"): not built yet. It needs a read-only endpoint for the
// rehearse reports and the PERCEIVE eval result (docs/ui-v3-plan.md, step 8), so it shows
// what it will hold, without numbers.
import { FlaskConical } from "lucide-react";
import { ComingLater, PageHeader } from "../ui";

export function Evaluation() {
  return (
    <div className="flex flex-col gap-8" data-testid="page-evaluation">
      <PageHeader
        chips={<FlaskConical className="size-5 text-sign-green" aria-hidden />}
        title="Evaluation"
        description="How well SIAGA reads signals and how reliably the demo runs."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <ComingLater title="Signal reading accuracy" testId="eval-perceive">
          The PERCEIVE test set has 20 driver messages and notices (make eval-perceive). Its score shows here once the result
          is served by the Case API.
        </ComingLater>
        <ComingLater title="Rehearsal runs" testId="eval-rehearse">
          make rehearse runs the demo end to end and records the pass rate and the time per stage. The latest report shows here
          once it is served by the Case API.
        </ComingLater>
      </div>
    </div>
  );
}
