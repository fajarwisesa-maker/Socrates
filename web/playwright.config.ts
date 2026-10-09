import { defineConfig } from "@playwright/test";

// Smoke test of the full demo. Expects the Case API on :8000 (fake LLM is fine) and the
// dashboard on :3000 - `make web-smoke` starts both. Screenshots go to e2e/screenshots/.
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  use: {
    baseURL: process.env.SIAGA_WEB_URL ?? "http://127.0.0.1:3000",
    viewport: { width: 1600, height: 1000 },
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  reporter: [["list"]],
});
