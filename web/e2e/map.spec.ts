import { expect, test } from "@playwright/test";

// UI v3 polish 5: no lane-map label sits on a road, on a marker or on another label, in every
// fixture state (/design/map: Assess, Act awaiting, Act after a rejection, Verify resolved,
// Verify re-opened, each option), at the Presenter width (576 px) and the Planner width.
test("lane map: labels never overlap roads, markers or each other", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/design/map");
  await expect(page.getByTestId("map-gallery")).toBeVisible();
  // roads draw in over two frames and 800 ms; reduced motion ends that at once
  await page.waitForTimeout(300);

  const problems = await page.evaluate(() => {
    type R = { l: number; t: number; r: number; b: number };
    const rect = (e: Element): R => {
      const b = e.getBoundingClientRect();
      return { l: b.left, t: b.top, r: b.right, b: b.bottom };
    };
    const hit = (a: R, b: R, pad = 0) => a.l < b.r - pad && b.l < a.r - pad && a.t < b.b - pad && b.t < a.b - pad;
    const out: string[] = [];
    document.querySelectorAll<HTMLElement>("figure[data-testid]").forEach((fig) => {
      const name = `${fig.dataset.testid} @${Math.round(fig.getBoundingClientRect().width)}px`;
      const groups = [...fig.querySelectorAll("[data-group]")].map((g) => ({
        g,
        r: rect(g),
        what: `${(g as HTMLElement).dataset.group} ${(g as HTMLElement).dataset.node ?? ""} "${g.textContent}"`,
      }));
      if (!groups.length) return; // the mini map has no labels
      // a phone-width map scrolls inside its frame at 640 px (max-md); the gallery's 360 px
      // frame only does so on a phone, so it is not a layout the dashboard ever shows
      if (fig.getBoundingClientRect().width < 560) return;
      const frame = rect(fig.querySelector("svg")!);
      // labels stay inside the map
      for (const a of groups)
        if (a.r.l < frame.l - 1 || a.r.r > frame.r + 1 || a.r.t < frame.t - 1 || a.r.b > frame.b + 1) out.push(`${name}: ${a.what} leaves the map`);
      // labels never overlap each other
      for (let i = 0; i < groups.length; i++)
        for (let j = i + 1; j < groups.length; j++)
          if (hit(groups[i].r, groups[j].r)) out.push(`${name}: ${groups[i].what} overlaps ${groups[j].what}`);
      // nor a marker
      fig.querySelectorAll("svg [data-marker]").forEach((m) => {
        for (const a of groups) if (hit(a.r, rect(m), 1)) out.push(`${name}: ${a.what} covers marker ${(m as SVGElement).dataset.marker}`);
      });
      // nor a road: sample each road's base stroke along its length
      const svg = fig.querySelector("svg") as SVGSVGElement;
      const ctm = svg.getScreenCTM()!;
      fig.querySelectorAll<SVGGElement>("svg g[data-road]").forEach((road) => {
        const path = road.querySelector("path") as SVGPathElement;
        const len = path.getTotalLength();
        const half = (Number(path.getAttribute("stroke-width")) / 2) * ctm.a;
        for (let s = 0; s <= 60; s++) {
          const p = path.getPointAtLength((len * s) / 60).matrixTransform(ctm);
          const dot = { l: p.x - half, r: p.x + half, t: p.y - half, b: p.y + half };
          for (const a of groups)
            if (hit(a.r, dot, 1)) {
              out.push(`${name}: ${a.what} sits on road ${road.dataset.road}`);
              break;
            }
        }
      });
    });
    return [...new Set(out)];
  });
  expect(problems).toEqual([]);
});
