import { expect, test, type Page } from "@playwright/test";

// Projector check: a washed-out projector is simulated by reducing contrast 30%
// (each sRGB channel c -> 0.5 + 0.7·(c − 0.5)). Every visible text on every Presenter
// step must stay readable: >= 4.5:1 for normal text, >= 3:1 for large text
// (>= 24px, or >= 18.66px bold), measured on the colours the browser actually paints.

test.use({ viewport: { width: 1280, height: 720 }, contextOptions: { reducedMotion: "reduce" } });

interface Finding {
  text: string;
  ratio: number;
  washed: number;
  size: number;
  large: boolean;
}

async function audit(page: Page): Promise<Finding[]> {
  return page.evaluate(() => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    const ctx = cv.getContext("2d", { willReadFrequently: true })!;
    const rgba = (c: string): number[] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "rgba(0,0,0,0)";
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0] / 255, d[1] / 255, d[2] / 255, d[3] / 255];
    };
    const over = (top: number[], a: number, base: number[]) => [0, 1, 2].map((i) => top[i] * a + base[i] * (1 - a));
    const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const lum = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
    const ratio = (a: number[], b: number[]) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    const wash = (c: number[]) => c.map((v) => 0.5 + (v - 0.5) * 0.7);

    function background(el: Element): number[] {
      const layers: number[][] = [];
      for (let n: Element | null = el; n; n = n.parentElement) {
        const c = rgba(getComputedStyle(n).backgroundColor);
        if (c[3] > 0) layers.push(c);
        if (c[3] >= 1) break;
      }
      let base = [1, 1, 1];
      for (const l of layers.reverse()) base = over(l, l[3], base);
      return base;
    }
    function opacity(el: Element): number {
      let o = 1;
      for (let n: Element | null = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
      return o;
    }

    const out: Finding[] = [];
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const svgText = el.tagName.toLowerCase() === "text";
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? "")
        .join("")
        .trim();
      if (!own) continue;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (cs.visibility === "hidden" || cs.display === "none" || r.width === 0 || r.height === 0) continue;
      if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue;
      if (el.closest("[aria-hidden='true']")) continue;
      const o = opacity(el);
      if (o < 0.05) continue;
      const fg = rgba(svgText ? cs.fill : cs.color);
      const bg = background(svgText ? (el.closest("svg")?.parentElement ?? el) : el);
      const paint = over(fg, fg[3] * o, bg);
      const size = svgText
        ? parseFloat(cs.fontSize) * ((el as SVGTextElement).getScreenCTM()?.a ?? 1)
        : parseFloat(cs.fontSize);
      const large = size >= 23.5 || (size >= 18.5 && Number(cs.fontWeight) >= 700);
      const washed = ratio(wash(paint), wash(bg));
      if (washed < (large ? 3 : 4.5)) {
        out.push({ text: own.slice(0, 60), ratio: +ratio(paint, bg).toFixed(2), washed: +washed.toFixed(2), size: Math.round(size), large });
      }
    }
    return out;
  });
}

test("projector check: every Presenter step stays readable at 30% less contrast", async ({ page }) => {
  test.setTimeout(180_000);
  await page.request.post("/api/demo/reset");
  await page.goto("/?mode=presenter&dwell=600"); // the keys move the view, nothing else
  await page.getByTestId("load-whatsapp").click();
  await page.getByTestId("load-pdf").click();
  const failures: Record<string, Finding[]> = {};
  failures["start"] = await audit(page);
  await page.getByTestId("presenter-start").click();
  await expect(page.getByTestId("next-step")).toBeVisible({ timeout: 60_000 }); // the agent is ahead

  const canvas = page.getByTestId("stage-canvas");
  for (let i = 0; i < 12; i++) {
    const stage = await canvas.getAttribute("data-stage");
    const round = await canvas.getAttribute("data-round");
    await page.waitForTimeout(600);
    failures[`${stage}-${round}`] = await audit(page);
    await page.screenshot({ path: `e2e/screenshots/projector-${String(i).padStart(2, "0")}-${stage}-${round}.png` });
    if (stage === "ACT") break;
    await page.keyboard.press("ArrowRight");
    await expect(canvas).not.toHaveAttribute("data-stage", stage!, { timeout: 5_000 }).catch(() => {});
  }
  await page.getByTestId("presenter-approve").click();
  await expect(page.getByTestId("presenter-sap-ref").nth(1)).toBeVisible({ timeout: 30_000 });
  failures["ACT-approved"] = await audit(page);
  await page.keyboard.press("l");
  await expect(page.getByTestId("final-line")).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(600);
  failures["VERIFY-resolved"] = await audit(page);
  await page.screenshot({ path: "e2e/screenshots/projector-99-VERIFY-resolved.png" });

  const bad = Object.fromEntries(Object.entries(failures).filter(([, f]) => f.length));
  expect(bad, JSON.stringify(bad, null, 1)).toEqual({});
});
