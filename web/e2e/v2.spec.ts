import { expect, test } from "@playwright/test";

// v2 UI additions (step 6): delay chip (DELAY_MODEL), PII chip (PII_MASKING), Architecture tab.
// Each check runs only when /config says its flag is on, so v1 runs skip them.
test("v2: delay chip on Assess, PII chip and the Architecture tab in Planner mode", async ({ page, request }) => {
  const config = await (await request.get("/api/config")).json();
  await request.post("/api/demo/reset");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/?mode=presenter&dwell=30");
  await page.getByTestId("load-whatsapp").click();
  await page.getByTestId("load-pdf").click();
  await page.getByTestId("presenter-start").click();
  await expect(page.getByTestId("next-step")).toContainText("Next: Assess", { timeout: 30_000 });
  await page.keyboard.press("Space");
  const chip = page.getByTestId("delay-chip");
  if (config.delay_model && config.delay_model !== "signal") {
    await expect(chip).toContainText("from 80 past disruptions");
    await expect(chip).toContainText(config.delay_model === "fake" ? "not RPT" : "SAP RPT-1.6");
    const box = await chip.boundingBox();
    expect(box!.height).toBeLessThan(40); // one line
  } else {
    await expect(chip).toHaveCount(0);
  }

  await page.goto("/?mode=planner&page=signals");
  await expect(page.getByTestId("planner")).toBeVisible();
  if (config.pii_masking === "local") {
    await expect(page.getByTestId("pii-chip")).toContainText("PII check · nothing to mask");
  } else {
    await expect(page.getByTestId("pii-chip")).toHaveCount(0);
  }
  if (config.delay_model && config.delay_model !== "signal") {
    await page.getByTestId("stage-ASSESS").getByRole("button").click();
    await expect(page.getByTestId("delay-details")).toContainText("risk uses");
  }
  await page.getByTestId("nav-architecture").click();
  const arch = page.getByTestId("architecture");
  await expect(arch).toBeVisible();
  await expect(page.getByTestId("arch-orchestrator")).toHaveAttribute("data-live", "1");
  await expect(page.getByTestId("arch-joule")).toHaveAttribute("data-live", "0");
  await expect(page.getByTestId("arch-rpt")).toHaveAttribute(
    "data-live",
    config.delay_model && config.delay_model !== "signal" ? "1" : "0",
  );
  if (config.orchestration === "multi") {
    await expect(page.getByTestId("arch-specialists")).toContainText("Executor Agent");
  }
  await page.screenshot({ path: "e2e/screenshots/v2-architecture.png", fullPage: true });
});
