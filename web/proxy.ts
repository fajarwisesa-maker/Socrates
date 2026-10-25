import { NextResponse, type NextRequest } from "next/server";

// The dashboard's /api/* calls go to the Case API (rewrite in next.config.ts). When the
// Case API needs a key (CASE_API_KEY, e.g. the deployed API in mode aws), it is added here,
// on the server: the browser never sees it.
export function proxy(request: NextRequest) {
  const key = process.env.CASE_API_KEY;
  if (!key) return NextResponse.next();
  const headers = new Headers(request.headers);
  headers.set("x-api-key", key);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: "/api/:path*" };
