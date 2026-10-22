import { expect, test } from "@playwright/test";

// v2 step 2 (ORCHESTRATION=multi): the specialist agents are visible in both modes.
// Skips when the Case API runs the v1 state machine.
test("multi-agent: rail names the agents, Perceive shows the English gloss", async ({ page, request }) => {
  const config = await (await request.get("/api/config")).json();
  test.skip(config.orchestration !== "multi", "Case API runs ORCHESTRATION=single");

  await request.post("/api/demo/reset");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/?mode=presenter&dwell=30");
  // the whole team is named before the case starts (from /config)
  await expect(page.getByTestId("rail-agent-PERCEIVE")).toHaveText("Signal Agent");
  await expect(page.getByTestId("rail-agent-ACT")).toHaveText("Executor Agent");

  await page.getByTestId("load-whatsapp").click();
  await page.getByTestId("load-pdf").click();
  await page.getByTestId("presenter-start").click();
  const canvas = page.getByTestId("stage-canvas");
  await expect(canvas).toHaveAttribute("data-stage", "PERCEIVE");
  await expect(page.getByTestId("gloss").filter({ hasText: "total gridlock" })).toBeVisible({ timeout: 30_000 });
  // the PDF phrases still fit on the canvas under the glossed WhatsApp
  const box = await page.getByTestId("signal-pdf").boundingBox();
  const frame = await page.locator("main section").filter({ has: canvas }).boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(frame!.y + frame!.height);

  await page.keyboard.press("l"); // jump to live: the approval card
  await expect(page.getByTestId("rail-agent-REFLECT")).toHaveText("Critic Agent");
  await page.keyboard.press("d");
  await page.getByTestId("drawer-tab-case").click();
  await expect(page.getByTestId("drawer-specialists")).toContainText("Impact Agent");
  await expect(page.getByTestId("drawer-specialists")).toContainText("Compute risk");
  await page.keyboard.press("Escape");

  await page.goto("/?mode=planner");
  await expect(page.getByTestId("agent-ASSESS")).toHaveText("Impact Agent");
  await expect(page.getByTestId("impact-note")).toContainText("Impact Agent");
  await expect(page.getByTestId("critic-note-B1")).toContainText("safety stock");
  await expect(page.getByTestId("approval-summary")).toContainText("approve by");
  await page.screenshot({ path: "e2e/screenshots/v2-planner.png", fullPage: true });
});
