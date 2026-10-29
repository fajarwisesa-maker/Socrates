import { expect, test, type Page } from "@playwright/test";

// UI v3 polish 4b: every screen agrees with the case status. A live run escalated after it
// had raised a Tier 3 card; the sidebar still said "1 waiting", the sign kept its countdown
// and buttons, and Approve showed "409 case is ESCALATED". This test plays that state back:
// the real golden case up to the approval, then the case read as ESCALATED with the card
// still PENDING (what the older backend returned) and the escalation event in ACT.
const REASON = "tool-call budget of 20 used up (test)";

async function escalate(page: Page) {
  await page.route(/\/api\/cases\/[^/?]+$/, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.case.status = "ESCALATED";
    body.case.escalation_reason = REASON;
    await route.fulfill({ response: res, json: body });
  });
  await page.route(/\/api\/cases\/[^/?]+\/events\?after=-?[01]$/, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    const seq = body.last_seq + 1;
    body.events.push({
      case_id: body.events[0]?.case_id ?? "",
      seq,
      stage: "ACT",
      status: "escalated",
      title: "Escalated to a human planner",
      detail: REASON,
      data: {},
      ts: new Date().toISOString(),
    });
    body.last_seq = seq;
    await route.fulfill({ response: res, json: body });
  });
}

test("escalated case: no Approve, no waiting badge, no countdown, no raw 409", async ({ page, request }) => {
  await request.post("/api/demo/reset");
  await page.goto("/?mode=planner");
  await page.getByRole("button", { name: "Load demo WhatsApp" }).click();
  await page.getByRole("button", { name: "Load forwarder PDF" }).click();
  await expect(page.getByTestId("pdf-name")).toHaveText("forwarder_notice.pdf");
  await page.getByTestId("start-case").click();
  await expect(page.getByTestId("case-status")).toHaveAttribute("data-status", "AWAITING_APPROVAL", { timeout: 90_000 });
  await expect(page.getByTestId("nav-count-approvals")).toHaveText("1 waiting");

  await escalate(page);
  await page.reload();
  await page.getByTestId("nav-approvals").click();

  // header, sidebar badge and page chip all say escalated
  await expect(page.getByTestId("case-status")).toHaveAttribute("data-status", "ESCALATED");
  await expect(page.getByTestId("case-status")).toHaveText("Escalated");
  await expect(page.getByTestId("nav-count-approvals")).toHaveText("escalated");
  await expect(page.getByTestId("approvals-chip")).toContainText("Escalated");
  await expect(page.getByText(/waiting/i)).toHaveCount(0);

  // the sign: escalated, the reason, a link to what happened; no countdown, no buttons
  const sign = page.getByTestId("approval-card");
  await expect(sign).toHaveAttribute("data-tone", "escalated");
  await expect(page.getByTestId("approval-label")).toHaveText("Escalated · not actionable");
  await expect(page.getByTestId("escalation-reason")).toContainText(REASON);
  await expect(page.getByTestId("approve-by")).toHaveCount(0);
  await expect(page.getByTestId("approve")).toHaveCount(0);
  await expect(page.getByTestId("reject-open")).toHaveCount(0);
  await expect(page.getByText(/\b409\b/)).toHaveCount(0);

  // the stepper: Act is where it escalated (red); Verify was never reached
  await expect(page.getByTestId("stage-ACT").locator("[data-post]")).toHaveAttribute("data-post", "flagged");
  await expect(page.getByTestId("stage-VERIFY").locator("[data-post]")).toHaveAttribute("data-post", "pending");
  await expect(page.getByTestId("stage-note-ACT")).toHaveText("Handed to a planner");

  await page.getByTestId("see-what-happened").click();
  await expect(page.getByTestId("audit-page")).toBeVisible();
});
