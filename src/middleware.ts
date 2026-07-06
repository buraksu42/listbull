/**
 * Next.js middleware — test-env noindex header + brand-owner ops dashboard gate.
 *
 * All routes: on test/preview deployments (NEXT_PUBLIC_ROBOTS=noindex,
 * ALLOW_INDEX=false, or NEXT_PUBLIC_ENV=test) every response gets an
 * X-Robots-Tag noindex header. Prod sets none of these, so the header stays
 * off. (Pattern mirrored from frame-marketing / bullsocial.)
 *
 * Ops gate: `/ops/*` and `/api/ops/*` require HTTP basic-auth via
 * LISTBULL_OPS_USER + LISTBULL_OPS_PASSWORD. Both env vars must be
 * set to enable the routes; if either is unset both routes return
 * **404** (not 401) so their existence is not advertised when ops
 * isn't deployed.
 *
 * Comparison uses Web Crypto SHA-256 + a constant-time byte loop to
 * eliminate timing leaks (both length and content). Runs on Edge —
 * crypto.subtle is available, `node:crypto` is not.
 *
 * Reads `process.env` directly (not the env.ts proxy) because the
 * proxy throws on missing required vars; an ops-unset deployment
 * must still boot.
 */
import { NextResponse, type NextRequest } from "next/server";

export const config = {
  // Everything except static assets — noindex header must reach all
  // crawlable routes. Ops gating still applies only to the ops paths.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

const NOINDEX =
  process.env.NEXT_PUBLIC_ROBOTS === "noindex" ||
  process.env.ALLOW_INDEX === "false" ||
  process.env.NEXT_PUBLIC_ENV === "test";

const NOINDEX_TAG =
  "noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate, noai, noimageai";

function withNoIndex(res: NextResponse): NextResponse {
  if (NOINDEX) res.headers.set("X-Robots-Tag", NOINDEX_TAG);
  return res;
}

const WWW_AUTHENTICATE = 'Basic realm="listbull-ops", charset="UTF-8"';

async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  // Hash both sides to a fixed 32-byte buffer — eliminates length leaks.
  // Web Crypto is available in Edge runtime; node:crypto is not.
  const enc = new TextEncoder();
  const [aHash, bHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const aBytes = new Uint8Array(aHash);
  const bBytes = new Uint8Array(bHash);
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    // `??0` shouldn't trip — both buffers are exactly 32 bytes — but
    // appeases noUncheckedIndexedAccess without an explicit non-null.
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

function parseBasicHeader(header: string): { user: string; pass: string } | null {
  if (!header.toLowerCase().startsWith("basic ")) return null;
  const b64 = header.slice(6).trim();
  let decoded: string;
  try {
    decoded = atob(b64);
  } catch {
    return null;
  }
  const colonIdx = decoded.indexOf(":");
  if (colonIdx === -1) return null;
  return {
    user: decoded.slice(0, colonIdx),
    pass: decoded.slice(colonIdx + 1),
  };
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  const isOps =
    pathname === "/ops" ||
    pathname.startsWith("/ops/") ||
    pathname === "/api/ops" ||
    pathname.startsWith("/api/ops/");

  // Non-ops routes: pass through, noindex header only.
  if (!isOps) {
    return withNoIndex(NextResponse.next());
  }

  const opsUser = process.env.LISTBULL_OPS_USER;
  const opsPass = process.env.LISTBULL_OPS_PASSWORD;

  // Ops not configured → routes don't exist. 404 instead of 401 so
  // probes can't tell whether the deployment has ops enabled.
  if (!opsUser || !opsPass) {
    return withNoIndex(new NextResponse("Not Found", { status: 404 }));
  }

  const authHeader = req.headers.get("authorization");
  const creds = authHeader ? parseBasicHeader(authHeader) : null;
  if (!creds) {
    return withNoIndex(
      new NextResponse("Authentication required", {
        status: 401,
        headers: { "WWW-Authenticate": WWW_AUTHENTICATE },
      }),
    );
  }

  // Both checks always run — short-circuit on user mismatch would leak
  // username validity via response timing.
  const [userOk, passOk] = await Promise.all([
    constantTimeEqual(creds.user, opsUser),
    constantTimeEqual(creds.pass, opsPass),
  ]);
  if (!userOk || !passOk) {
    return withNoIndex(
      new NextResponse("Invalid credentials", {
        status: 401,
        headers: { "WWW-Authenticate": WWW_AUTHENTICATE },
      }),
    );
  }

  return withNoIndex(NextResponse.next());
}
