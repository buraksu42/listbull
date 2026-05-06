import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/auth/cookie";

/**
 * Edge-runtime gate (Next 16 "proxy" — formerly middleware): redirect
 * unauthenticated users hitting Mini App routes to the marketing root. Real
 * session validation happens server-side in route handlers — this is a cheap
 * presence check (cookie exists). API routes are gated per-handler.
 */
export function proxy(request: NextRequest) {
  const cookie = request.cookies.get(SESSION_COOKIE_NAME);
  if (!cookie?.value) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

/**
 * Gate everything under the Mini App route group EXCEPT /app itself, which
 * runs the initData → session boot flow before a cookie exists.
 */
export const config = {
  matcher: ["/lists/:path*", "/settings/:path*", "/invites/:path*"],
};
