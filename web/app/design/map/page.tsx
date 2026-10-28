// Lane-map gallery: every view of the map from recorded demo cases (fake LLM), at the
// Presenter canvas width (576px at 1280x720), the Planner sheet width and a narrow phone
// width (the map scrolls inside its frame). Not linked from the dashboard.
import { LaneMap } from "@/components/LaneMap";
import { laneModel, type LaneView } from "@/lib/laneModel";
import type { CaseRecord } from "@/lib/types";
import fixtures from "../fixtures.json";

const CASES = fixtures as unknown as Record<string, { case: CaseRecord }>;

export default function MapGallery() {
  const awaiting = CASES.awaiting.case;
  const views: [string, CaseRecord, LaneView][] = [
    ["Assess", awaiting, { kind: "assess" }],
    ["Act (awaiting approval)", awaiting, { kind: "act" }],
    ["Act (bridge rejected, air pending)", CASES.rejected.case, { kind: "act" }],
    ["Verify (resolved)", CASES.resolved.case, { kind: "verify" }],
    ["Verify (re-opened)", CASES.reopened.case, { kind: "verify" }],
    ...awaiting.solver_results.map(
      (o) => [`Option ${o.option_id}`, awaiting, { kind: "option", option: o, rejected: o.option_id === "B1" }] as [string, CaseRecord, LaneView],
    ),
  ];
  return (
    <main className="space-y-10 p-8" data-testid="map-gallery">
      {views.map(([name, record, view]) => {
        const model = laneModel(record, view);
        return (
          <section key={name} className="space-y-2">
            <h2 className="sign-label text-sm">{name}</h2>
            {model && (
              <div className="flex flex-wrap items-start gap-6">
                <div style={{ width: 576 }}>
                  <LaneMap model={model} size="sm" testId={`map-${name}`} />
                </div>
                <div style={{ width: 860 }}>
                  <LaneMap model={model} />
                </div>
                {view.kind === "option" && (
                  <div style={{ width: 220 }}>
                    <LaneMap model={model} variant="mini" />
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}
      <section className="space-y-2">
        <h2 className="sign-label text-sm">Narrow (scrolls inside its frame)</h2>
        <div style={{ width: 360 }}>
          <LaneMap model={laneModel(awaiting, { kind: "assess" })!} />
        </div>
      </section>
    </main>
  );
}
