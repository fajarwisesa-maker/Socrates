import { expect, test } from "@playwright/test";

// UI v3 (the owner's mockup): every sidebar page renders the golden case without a
// horizontal scroll, at the projector size and a desk size, and ?page= survives a reload.
const PAGES = ["overview", "signals", "impact", "options", "approvals", "verification", "audit", "architecture", "evaluation"];

test("planner pages: each renders the case, no horizontal scroll, ?page= reloads", async ({ page, request }) => {
  await request.post("/api/demo/reset");
  await page.goto("/?mode=planner");
  await page.getByRole("button", { name: "Load demo WhatsApp" }).click();
  await page.getByRole("button", { name: "Load forwarder PDF" }).click();
  await expect(page.getByTestId("pdf-name")).toHaveText("forwarder_notice.pdf");
  await page.getByTestId("start-case").click();
  await expect(page.getByTestId("case-status")).toHaveAttribute("data-status", "AWAITING_APPROVAL", { timeout: 90_000 });

  for (const size of [
    { width: 1280, height: 720 },
    { width: 1600, height: 1000 },
  ]) {
    await page.setViewportSize(size);
    for (const p of PAGES) {
      await page.getByTestId(`nav-${p}`).click();
      await expect(page.getByTestId(`nav-${p}`)).toHaveAttribute("aria-current", "page");
      await expect(page.getByTestId("page-title")).toBeVisible();
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(wide, `${p} at ${size.width}px scrolls sideways`).toBeLessThanOrEqual(0);
    }
  }
  // the numbers on the pages are the backend's
  await page.getByTestId("nav-overview").click();
  await expect(page.getByTestId("kpi-exposure")).toContainText("Rp 340 jt");
  await page.getByTestId("nav-options").click();
  await expect(page.getByTestId("saving-banner")).toContainText("Rp 19,6 jt");

  await page.getByTestId("nav-impact").click();
  await expect(page).toHaveURL(/page=impact/);
  await page.reload();
  await expect(page.getByTestId("page-impact")).toBeVisible();
});
