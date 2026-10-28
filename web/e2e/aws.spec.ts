import { expect, test } from "@playwright/test";

// AWS backends (SOLVER_BACKEND=lambda, AUDIT_BACKEND=s3): the Simulate canvas says the
// solver ran on AWS Lambda, the drawer labels each solver call, and the audit trail shows
// its S3 copy and reads it back on demand. The smoke run points boto3 at a local stand-in
// (tests/aws_standin.py); skipped when the API runs the local backends.
test("aws: solver on Lambda, audit trail in S3 with Object Lock", async ({ page, request }) => {
  const config = await (await request.get("/api/config")).json();
  test.skip(config.backends?.solver !== "lambda" || config.backends?.audit !== "s3", "local backends");
  await request.post("/api/demo/reset");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/?mode=presenter&auto=1");
  await page.getByTestId("load-whatsapp").click();
  await page.getByTestId("load-pdf").click();
  await page.getByTestId("presenter-start").click();
  await expect(page.getByTestId("presenter-approve")).toBeVisible({ timeout: 60_000 });

  await page.getByTestId("rail-SIMULATE").getByRole("button").click();
  await expect(page.getByTestId("solver-label")).toHaveText("Calculated by the solver on AWS Lambda, not AI");
  await page.screenshot({ path: "e2e/screenshots/aws-simulate-lambda.png" });

  await page.keyboard.press("d");
  const drawer = page.getByTestId("details-drawer");
  await expect(drawer.getByTestId("computed-on").first()).toHaveText("on AWS Lambda");
  await drawer.getByTestId("drawer-tab-audit").click();
  await expect(drawer.getByTestId("audit-s3")).toContainText("S3 Object Lock");
  await expect(drawer.getByTestId("audit-s3")).toContainText(/\d+\/\d+ stored/);
  await drawer.getByTestId("audit-s3-verify").click();
  await expect(drawer.getByTestId("audit-s3-result")).toContainText("chain intact, same as local", {
    timeout: 15_000,
  });
  await expect(drawer.getByTestId("audit-s3-result")).toContainText("governance lock until");
  await page.screenshot({ path: "e2e/screenshots/aws-audit-s3.png" });

  await drawer.getByTestId("drawer-tab-architecture").click();
  await expect(drawer.getByTestId("arch-solver")).toContainText("AWS Lambda siaga-solver");
  await expect(drawer.getByTestId("arch-audit")).toContainText("S3 Object Lock");
});
