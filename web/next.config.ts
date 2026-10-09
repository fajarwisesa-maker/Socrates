import type { NextConfig } from "next";

// The dashboard calls the Case API through /api/* so the browser never needs CORS.
const API = process.env.SIAGA_API_URL ?? "http://127.0.0.1:8000";

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
