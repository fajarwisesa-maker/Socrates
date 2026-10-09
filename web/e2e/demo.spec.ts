import { expect, test } from "@playwright/test";

const shots = (name: string) => ({ path: `e2e/screenshots/${name}.png`, fullPage: true });

test("demo case: signal -> approval -> verified", async ({ page, request }) => {
  await request.post("/api/demo/reset");
  await page.goto("/");
  await expect(page.getByTestId("signal-inbox")).toBeVisible();

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
  await page.screenshot(shots("3-verified"));
});

test("rejecting the bridge PO replans the remaining shortfall to air", async ({ page, request }) => {
  await request.post("/api/demo/reset");
  await page.goto("/");
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
