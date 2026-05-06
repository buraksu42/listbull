/**
 * `POST /api/billing/portal` — return a Stripe Customer Portal URL
 * for self-service billing management (cancel, change plan, update
 * card). Owner-only.
 */
import { NextResponse } from "next/server";

import { eq } from "drizzle-orm";

import { getSessionUserId } from "@/lib/auth/session";
import { getStripe } from "@/lib/billing/stripe";
import { db } from "@/lib/db/client";
import { subscriptions } from "@/lib/db/schema";
import { getWorkspaceMembership } from "@/lib/db/queries/workspaces";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: { code: "unauthorized", message: "Sign in via Telegram" } },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "bad_request", message: "Invalid JSON" } },
      { status: 400 },
    );
  }

  const workspaceId =
    typeof (body as { workspaceId?: unknown }).workspaceId === "string"
      ? (body as { workspaceId: string }).workspaceId
      : null;
  if (!workspaceId) {
    return NextResponse.json(
      { ok: false, error: { code: "invalid_input", message: "workspaceId required" } },
      { status: 400 },
    );
  }

  const membership = await getWorkspaceMembership(userId, workspaceId);
  if (!membership || membership.role !== "owner") {
    return NextResponse.json(
      { ok: false, error: { code: "forbidden", message: "Owner only" } },
      { status: 403 },
    );
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "service_unavailable", message: "Billing not configured" },
      },
      { status: 503 },
    );
  }

  const [sub] = await db
    .select({
      providerCustomerId: subscriptions.providerCustomerId,
      provider: subscriptions.provider,
    })
    .from(subscriptions)
    .where(eq(subscriptions.workspaceId, workspaceId))
    .limit(1);
  if (!sub || sub.provider !== "stripe") {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "not_found",
          message: "No Stripe subscription on this workspace.",
        },
      },
      { status: 404 },
    );
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: sub.providerCustomerId,
    return_url: `${env.NEXT_PUBLIC_APP_URL}/workspace/settings`,
  });

  return NextResponse.json({ ok: true, data: { url: session.url } });
}
