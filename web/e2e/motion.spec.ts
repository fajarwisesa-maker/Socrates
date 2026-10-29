import { expect, test, type Locator } from "@playwright/test";

// Motion never blocks work (docs/polish-prompt.md 2): with motion on, the Approve button
// takes a real click at its centre on the first frame it is visible, in both modes.
test.use({ contextOptions: { reducedMotion: "no-preference" } });

/** Enabled, takes pointer events and is the topmost element at its centre right now. */
async function clickableNow(button: Locator) {
  return button.evaluate((el) => {
    const b = el.getBoundingClientRect();
    const x = b.left + b.width / 2;
    const y = b.top + b.height / 2;
    const top = document.elementFromPoint(x, y);
    return {
      enabled: !(el as HTMLButtonElement).disabled,
      pointer: getComputedStyle(el).pointerEvents !== "none",
      onTop: !!top && (top === el || el.contains(top)),
      x,
      y,
    };
  });
}

test("motion on: Approve is clickable as soon as it is visible (Presenter)", async ({ page }) => {
  await page.request.post("/api/demo/reset");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/?mode=presenter&auto=1");
  await page.getByTestId("load-whatsapp").click();
  await page.getByTestId("load-pdf").click();
  await page.getByTestId("presenter-start").click();
  const approve = page.getByTestId("presenter-approve");
  await approve.waitFor({ state: "visible", timeout: 60_000 });
  const at = await clickableNow(approve);
  expect(at).toMatchObject({ enabled: true, pointer: true, onTop: true });
  // a real mouse click at that point, without waiting for the entrance to settle
  await page.mouse.click(at.x, at.y);
  // auto=1: the view follows the case straight on to Verify
  await expect(page.getByTestId("final-line")).toHaveText("Rp 340 jt protected for Rp 11,4 jt", { timeout: 60_000 });
});

test("motion on: Approve is clickable as soon as it is visible (Planner)", async ({ page }) => {
  await page.request.post("/api/demo/reset");
  await page.goto("/?mode=planner");
  await page.getByRole("button", { name: "Load demo WhatsApp" }).click();
  await page.getByRole("button", { name: "Load forwarder PDF" }).click();
  await page.getByTestId("start-case").click();
  await page.getByTestId("nav-approvals").click();
  const approve = page.getByTestId("approve");
  await approve.waitFor({ state: "visible", timeout: 90_000 });
  await approve.evaluate((el) => el.scrollIntoView({ block: "center" })); // no actionability wait
  const at = await clickableNow(approve);
  expect(at).toMatchObject({ enabled: true, pointer: true, onTop: true });
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId("po-number")).toContainText(/45000182\d\d/, { timeout: 30_000 });
  // focus moves to the next action, and the result is announced
  await expect(page.getByTestId("go-verify")).toBeFocused();
  await expect(page.getByTestId("approval-card").first().locator('[aria-live="polite"]')).toContainText("Approved");
});
