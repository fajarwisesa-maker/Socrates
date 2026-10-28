import { expect, test } from "@playwright/test";

// WhatsApp inbound (WHATSAPP_INBOUND=1): a case opened by the webhook, not by this page, is
// followed by itself and labelled as received live. The webhook's forward to POST /cases is
// simulated here; its signature, allowlist and dedupe are covered by tests/test_whatsapp.py.
test("whatsapp: the dashboard follows a case opened from WhatsApp", async ({ page, request }) => {
  const config = await (await request.get("/api/config")).json();
  test.skip(!config.whatsapp_inbound, "WHATSAPP_INBOUND is off on this API");
  await request.post("/api/demo/reset");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/?mode=presenter&dwell=30"); // long dwell: the view stays on Perceive
  await expect(page.getByTestId("presenter-start")).toBeVisible();
  // let the page finish loading: its "resume the latest case" request must not see the new
  // case (a case found on load opens at its latest step, like a reload)
  await page.waitForLoadState("networkidle");

  const text = await (await request.get("/api/demo/inputs/whatsapp")).text();
  const r = await request.post("/api/cases", {
    multipart: {
      whatsapp: text,
      source_channel: "whatsapp_api",
      source_ref: "wamid.e2e",
      source_sender: "6281234567890",
      source_received_at: new Date().toISOString(),
    },
  });
  expect(r.status()).toBe(202);

  // no click: the page switches to the new case and plays it from Perceive
  const live = page.getByTestId("whatsapp-live");
  await expect(live).toContainText("received live from +62 ••• 7890", { timeout: 30_000 });
  await expect(page.getByText("6281234567890")).toHaveCount(0);
  await page.screenshot({ path: "e2e/screenshots/whatsapp-live.png" });
});
