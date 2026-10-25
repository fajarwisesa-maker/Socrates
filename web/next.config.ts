import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

// The laptop mode lives in the repo root's .env (make use-aws|use-replay|use-v1). Take the
// Case API URL and key from there unless the shell sets them; the key is used only by
// proxy.ts on the server.
function rootEnv(name: string): string | undefined {
  try {
    const text = readFileSync(join(process.cwd(), "..", ".env"), "utf8");
    const m = text.match(new RegExp(`^${name}=(.*)$`, "m"));
    const v = m?.[1].replace(/\s+#.*$/, "").trim().replace(/^(["'])(.*)\1$/, "$2");
    return v && v !== "<set-me>" ? v : undefined;
  } catch {
    return undefined;
  }
}
const key = process.env.CASE_API_KEY ?? rootEnv("CASE_API_KEY");
if (key) process.env.CASE_API_KEY = key;

// The dashboard calls the Case API through /api/* so the browser never needs CORS.
const API = process.env.SIAGA_API_URL ?? rootEnv("CASE_API_URL") ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  // The smoke test builds into its own directory so it never collides with `next dev`.
  distDir: process.env.SIAGA_DIST_DIR ?? ".next",
  // The smoke test and some demo setups open the dashboard as 127.0.0.1.
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: false, // keep the projector view clean
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  rewrites() {
    return [{ source: "/api/:path*", destination: `${API}/:path*` }];
  },
};

export default nextConfig;
