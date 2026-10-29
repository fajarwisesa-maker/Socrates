import { defineConfig } from "@playwright/test";

// Smoke test of the full demo. Expects the Case API on :8000 (fake LLM is fine) and the
// dashboard on :3000 - `make web-smoke` starts both. Screenshots go to e2e/screenshots/.
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  // every test resets the one demo Case API it shares, so tests must not run in parallel
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: process.env.SIAGA_WEB_URL ?? "http://127.0.0.1:3000",
    viewport: { width: 1600, height: 1000 },
    // tests never wait on animations (lib/motion.ts and globals.css end them at once);
    // e2e/motion.spec.ts turns motion back on to check nothing waits for it
    contextOptions: { reducedMotion: "reduce" },
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  reporter: [["list"]],
});
