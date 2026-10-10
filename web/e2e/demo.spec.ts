import { expect, test } from "@playwright/test";

const shots = (name: string) => ({ path: `e2e/screenshots/${name}.png`, fullPage: true });

test("demo case: signal -> approval -> verified", async ({ page, request }) => {
  await request.post("/api/demo/reset");
  await page.goto("/?mode=planner"); // the dense view keeps the full set of test ids
  await expect(page.getByTestId("signal-inbox")).toBeVisible();
  if (process.env.SIAGA_EXPECT_REPLAY) {
    await expect(page.getByTestId("replay-badge")).toContainText("REPLAY");
  }

  await page.getByRole("button", { name: "Load demo WhatsApp" }).click();
  await expect(page.getByTestId("whatsapp-input")).toHaveValue(/Brebes/);
  await page.getByRole("button", { name: "Load forwarder PDF" }).click();
  await expect(page.getByTestId("pdf-name")).toHaveText("forwarder_notice.pdf");
  await page.screenshot(shots("1-inbox"));

  await page.getByTestId("start-case").click();
  const card = page.getByTestId("approval-card").first();
  await expect(card).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("exposure")).toHaveText("Rp 340.000.000");
  await expect(page.getByTestId("option-B1")).toContainText("Rp 8.100.000");
  await expect(page.getByTestId("option-B1")).toContainText("rejected: safety_stock");
  await expect(page.getByTestId("option-B2")).toContainText("Rp 11.400.000");
  await expect(page.getByTestId("option-B2")).toContainText("chosen");
  await expect(page.getByTestId("option-A1")).toContainText("Rp 31.000.000");
  await expect(card).toContainText("Rp 7.500.000");
  await expect(card).toContainText("Day 1 18:00");
  await expect(page.getByTestId("stage-ACT")).toHaveAttribute("data-state", "waiting");
  await page.getByTestId("stage-REFLECT").getByRole("button").click();
  await page.screenshot(shots("2-awaiting-approval"));

  await page.getByTestId("approve").click();
  await expect(page.getByTestId("po-number")).toContainText(/45000182\d\d/, { timeout: 30_000 });
  await expect(page.getByTestId("case-status")).toContainText("RESOLVED", { timeout: 90_000 });
  await expect(page.getByTestId("stage-VERIFY")).toHaveAttribute("data-state", "done");
  await expect(page.getByTestId("audit-status")).toContainText("hash chain verified", {
    timeout: 10_000,
  });
  await page.getByTestId("stage-VERIFY").getByRole("button").click();
  await page.getByRole("button", { name: /Show \d+ entries/ }).click();
  await page.screenshot(shots(process.env.SIAGA_EXPECT_REPLAY ? "5-replay-verified" : "3-verified"));
});

test("rejecting the bridge PO replans the remaining shortfall to air", async ({ page, request }) => {
  await request.post("/api/demo/reset");
  await page.goto("/?mode=planner"); // the dense view keeps the full set of test ids
  await page.getByRole("button", { name: "Load demo WhatsApp" }).click();
  await page.getByRole("button", { name: "Load forwarder PDF" }).click();
  await expect(page.getByTestId("pdf-name")).toHaveText("forwarder_notice.pdf");
  await page.getByTestId("start-case").click();

  const bridge = page.getByTestId("approval-card").filter({ hasText: /^Bridge PO/ });
  await expect(bridge).toBeVisible({ timeout: 90_000 });
  await bridge.getByPlaceholder(/Reason/).fill("V-2002 failed QC last month");
  await bridge.getByTestId("reject").click();

  // Match the new card by its title (the bridge card mentions air as an alternative).
  const air = page
    .getByTestId("approval-card")
    .filter({ hasText: /Air charter Q-AIR-0001 for 500 cartons/ });
  await expect(air).toBeVisible({ timeout: 90_000 });
  await expect(air).toHaveAttribute("data-status", "PENDING");
  await expect(air).toContainText("Rp 31.000.000");
  await expect(page.getByTestId("stage-ACT")).toHaveAttribute("data-state", "waiting");
  await expect(bridge).toHaveAttribute("data-status", "REJECTED");
  await page.screenshot(shots("4-rejected-replanned-to-air"));
});

test("presenter mode: rail, impact meter and clock follow the case", async ({ page }) => {
  await page.request.post("/api/demo/reset");
  await page.goto("/?mode=presenter");
  await expect(page.getByTestId("start-canvas")).toBeVisible();
  await page.getByTestId("load-whatsapp").click();
  await page.getByTestId("load-pdf").click();
  await page.getByTestId("presenter-start").click();

  await expect(page.getByTestId("rail-ACT")).toHaveAttribute("data-state", "waiting", { timeout: 60_000 });
  await expect(page.getByTestId("rail-replans")).toHaveText(/1 replan/);
  await expect(page.getByTestId("meter-at-risk")).toContainText("Rp 340 jt");
  await expect(page.getByTestId("meter-plan-cost")).toContainText("Rp 11,4 jt");
  await expect(page.getByTestId("meter-protected")).toContainText("Rp 328,6 jt");

  // canvases from the event stream: the Critic's sentence, the approval card, one-click approve
  await page.getByTestId("rail-REFLECT").getByRole("button").click();
  await expect(page.getByTestId("critic-reason")).toHaveText(/Bandung DC would drop to 50 cartons, below its safety stock of 400/);
  await page.getByTestId("rail-PERCEIVE").getByRole("button").click();
  await expect(page.getByTestId("confidence")).toContainText("Medium→High");
  await expect(page.locator('[data-testid="signal-whatsapp"] mark')).toContainText(["macet total"]);
  await page.getByTestId("follow-live").click();
  await expect(page.getByTestId("approve-by")).toContainText("Approve by Day 1 18:00");
  await page.getByTestId("presenter-approve").click();
  await expect(page.getByTestId("rail-VERIFY")).toHaveAttribute("data-state", "done", { timeout: 60_000 });
  await expect(page.getByTestId("final-line")).toHaveText("Rp 340 jt protected for Rp 11,4 jt");

  // P switches to Planner mode and back
  await page.keyboard.press("p");
  await expect(page.getByTestId("timeline")).toBeVisible();
  await page.keyboard.press("p");
  await expect(page.getByTestId("presenter")).toBeVisible();
});
