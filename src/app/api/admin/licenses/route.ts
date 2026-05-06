/**
 * SaaS-side license issuance + listing endpoint (Phase 6).
 *
 *   GET  /api/admin/licenses     — list all licenses (no JWT)
 *   POST /api/admin/licenses     — issue + sign a new license,
 *                                  return JWT once
 *
 * Gate: header `x-listbull-admin-token` matches env
 * LICENSE_ADMIN_TOKEN. Operator-only route — no Telegram session.
 * Token is the only auth surface; pick a long random string and
 * scope to ops staff.
 */
import { NextResponse } from "next/server";

import { issueLicense, listLicenses } from "@/lib/billing/license";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_HEADER = "x-listbull-admin-token";

function authorize(request: Request): NextResponse | null {
  if (!env.LICENSE_ADMIN_TOKEN) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "service_unavailable",
          message: "License admin token not configured.",
        },
      },
      { status: 503 },
    );
  }
  const provided = request.headers.get(ADMIN_HEADER);
  if (provided !== env.LICENSE_ADMIN_TOKEN) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "unauthorized",
          message: "Invalid admin token",
        },
      },
      { status: 401 },
    );
  }
  return null;
}

export async function GET(request: Request) {
  const auth = authorize(request);
  if (auth) return auth;

  const items = await listLicenses();
  return NextResponse.json({ ok: true, data: { licenses: items } });
}

export async function POST(request: Request) {
  const auth = authorize(request);
  if (auth) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "bad_request", message: "Invalid JSON" } },
      { status: 400 },
    );
  }

  const {
    tier,
    seats,
    email,
    workspaces,
    expiresAt,
    sourceProvider,
    sourceReference,
  } = body as {
    tier?: unknown;
    seats?: unknown;
    email?: unknown;
    workspaces?: unknown;
    expiresAt?: unknown;
    sourceProvider?: unknown;
    sourceReference?: unknown;
  };

  if (
    (tier !== "team" && tier !== "workspace") ||
    typeof seats !== "number" ||
    typeof email !== "string" ||
    !Array.isArray(workspaces) ||
    workspaces.some((w) => typeof w !== "string")
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "invalid_input",
          message:
            "tier, seats, email, workspaces[] required; seats positive int",
        },
      },
      { status: 400 },
    );
  }

  let expiresDate: Date | undefined;
  if (typeof expiresAt === "string") {
    const parsed = new Date(expiresAt);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "invalid_input",
            message: "expiresAt must be a valid ISO 8601 string",
          },
        },
        { status: 400 },
      );
    }
    expiresDate = parsed;
  }

  const result = await issueLicense({
    tier,
    seats,
    email,
    workspaces: workspaces as string[],
    expiresAt: expiresDate,
    sourceProvider:
      sourceProvider === "stripe" ||
      sourceProvider === "iyzico" ||
      sourceProvider === "manual"
        ? sourceProvider
        : "manual",
    sourceReference:
      typeof sourceReference === "string" ? sourceReference : undefined,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: result.reason,
          message:
            result.reason === "no_private_key"
              ? "LICENSE_PRIVATE_KEY not configured"
              : "Invalid input",
        },
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    data: { jwt: result.jwt, license: result.license },
  });
}
