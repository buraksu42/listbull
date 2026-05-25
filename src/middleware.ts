/**
 * Next.js middleware — brand-owner ops dashboard gate.
 *
 * Matches `/ops/*` and `/api/ops/*` and requires HTTP basic-auth via
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
  // Only the ops routes are gated. Everything else passes through with
  // no middleware overhead.
  matcher: ["/ops/:path*", "/api/ops/:path*"],
};

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
  const opsUser = process.env.LISTBULL_OPS_USER;
  const opsPass = process.env.LISTBULL_OPS_PASSWORD;

  // Ops not configured → routes don't exist. 404 instead of 401 so
  // probes can't tell whether the deployment has ops enabled.
  if (!opsUser || !opsPass) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const authHeader = req.headers.get("authorization");
  const creds = authHeader ? parseBasicHeader(authHeader) : null;
  if (!creds) {
    return new NextResponse("Authentication required", {
      status: 401,
      headers: { "WWW-Authenticate": WWW_AUTHENTICATE },
    });
  }

  // Both checks always run — short-circuit on user mismatch would leak
  // username validity via response timing.
  const [userOk, passOk] = await Promise.all([
    constantTimeEqual(creds.user, opsUser),
    constantTimeEqual(creds.pass, opsPass),
  ]);
  if (!userOk || !passOk) {
    return new NextResponse("Invalid credentials", {
      status: 401,
      headers: { "WWW-Authenticate": WWW_AUTHENTICATE },
    });
  }

  return NextResponse.next();
}
