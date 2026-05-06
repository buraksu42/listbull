/**
 * `POST /api/billing/checkout` — create a Stripe Checkout Session
 * (or Iyzico hosted-checkout URL) for the active workspace.
 *
 * Phase 4.5: Stripe path implemented; Iyzico path returns 501 with
 * `iyzico_phase_5` until the SDK lands. Provider routing follows
 * the user's billing country (locked at first paid signup; for now
 * we hardcode Stripe on every signup since Iyzico flow is deferred).
 *
 * The session metadata carries `workspace_id` so the webhook handler
 * can route the resulting subscription back to the workspace.
 */
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import {
  createIyzicoCheckout,
  getIyzipay,
  iyzicoPlanForTier,
} from "@/lib/billing/iyzico";
import { getStripe } from "@/lib/billing/stripe";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { getWorkspaceMembership } from "@/lib/db/queries/workspaces";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_TIERS = new Set(["team", "workspace"]);

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

  const parsed = body as { workspaceId?: unknown; tier?: unknown };
  const workspaceId =
    typeof parsed.workspaceId === "string" ? parsed.workspaceId : null;
  const tier =
    typeof parsed.tier === "string" ? parsed.tier.toLowerCase() : null;

  if (!workspaceId || !tier || !ALLOWED_TIERS.has(tier)) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "invalid_input",
          message: "workspaceId + tier ('team' | 'workspace') required",
        },
      },
      { status: 400 },
    );
  }

  // Caller must be the workspace owner.
  const membership = await getWorkspaceMembership(userId, workspaceId);
  if (!membership || membership.role !== "owner") {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "forbidden", message: "Only the workspace owner can subscribe" },
      },
      { status: 403 },
    );
  }

  // Provider routing: TR locale → Iyzico (if configured); else Stripe.
  // First-paid customer's choice locks via billing_customers row in
  // Phase 5+ — for now we re-resolve per checkout from user.locale.
  const [user] = await db
    .select({
      locale: users.locale,
      email: users.telegramUsername,
      firstName: users.telegramFirstName,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: { code: "not_found", message: "User not found" } },
      { status: 404 },
    );
  }

  const useIyzico = user.locale === "tr" && getIyzipay() !== null;

  if (useIyzico) {
    const planRef = iyzicoPlanForTier(tier as "team" | "workspace");
    if (!planRef) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "service_unavailable",
            message: `Iyzico plan not configured for tier: ${tier}`,
          },
        },
        { status: 503 },
      );
    }

    const result = await createIyzicoCheckout({
      pricingPlanReferenceCode: planRef,
      conversationId: `workspace:${workspaceId}|tier:${tier}|user:${userId}`,
      callbackUrl: `${env.NEXT_PUBLIC_APP_URL}/billing/success?ws=${workspaceId}&provider=iyzico`,
      customer: {
        name: user.firstName ?? "Listbull",
        // Iyzico requires surname; we don't store one, fall back to "User".
        surname: "User",
        email: user.email ? `${user.email}@telegram.local` : "noreply@listbull.org",
        city: "Istanbul",
        address: "n/a",
        country: "Turkey",
      },
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: "iyzico_failure", message: result.reason },
        },
        { status: 502 },
      );
    }

    // Iyzico hosted-checkout token URL pattern.
    const checkoutUrl = `${env.IYZICO_BASE_URL}/payment/iyzipos/checkoutform/auth/ecom/${result.token}`;
    return NextResponse.json({
      ok: true,
      data: { url: checkoutUrl, sessionId: result.referenceCode },
    });
  }

  // Default: Stripe.
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "service_unavailable",
          message: "Billing not configured on this deployment.",
        },
      },
      { status: 503 },
    );
  }

  const priceId =
    tier === "team" ? env.STRIPE_PRICE_TEAM : env.STRIPE_PRICE_WORKSPACE;
  if (!priceId) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "service_unavailable",
          message: `Stripe price not configured for tier: ${tier}`,
        },
      },
      { status: 503 },
    );
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { workspace_id: workspaceId, user_id: userId, tier },
    subscription_data: {
      metadata: { workspace_id: workspaceId, user_id: userId, tier },
    },
    success_url: `${env.NEXT_PUBLIC_APP_URL}/billing/success?ws=${workspaceId}`,
    cancel_url: `${env.NEXT_PUBLIC_APP_URL}/workspace/settings`,
    allow_promotion_codes: true,
  });

  return NextResponse.json({
    ok: true,
    data: { url: session.url, sessionId: session.id },
  });
}
