/**
 * `POST /api/webhooks/stripe` — subscription lifecycle handler.
 *
 * Verifies the `Stripe-Signature` header → constructs the typed event
 * → idempotency check → upserts `subscriptions` rows for relevant
 * events. Mutations are atomic per event; non-relevant events return
 * 200 immediately so Stripe stops retrying.
 *
 * Phase 4.5: writes subscription rows; tier-enforce middleware reads
 * them. Phase 5 flips BILLING_ENFORCE=true so 402s actually surface.
 */
import { NextResponse } from "next/server";

import { eq } from "drizzle-orm";
import type Stripe from "stripe";

import { isReplay } from "@/lib/billing/idempotency";
import { priceToTier, verifyStripeWebhook } from "@/lib/billing/stripe";
import { db } from "@/lib/db/client";
import { subscriptions, workspaces } from "@/lib/db/schema";
import { TIER_LIMITS, type WorkspaceTier } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const sigHeader = request.headers.get("stripe-signature");
  const event = verifyStripeWebhook(rawBody, sigHeader);
  if (!event) {
    return NextResponse.json(
      { ok: false, error: { code: "invalid_signature", message: "Bad signature" } },
      { status: 401 },
    );
  }

  if (isReplay(event.id)) {
    // Already processed — Stripe replays on hiccups. Idempotent OK.
    return NextResponse.json({ ok: true, replayed: true });
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await handleSubscriptionUpsert(event.data.object);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object);
        break;
      case "invoice.payment_failed":
        await handlePaymentFailed(event.data.object);
        break;
      default:
        // Non-essential event — 200 so Stripe stops retrying.
        break;
    }
  } catch (err) {
    console.error("[stripe webhook] handler threw", err);
    return NextResponse.json(
      { ok: false, error: { code: "internal_error", message: "Handler failed" } },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

async function handleSubscriptionUpsert(
  sub: Stripe.Subscription,
): Promise<void> {
  // We pass workspace_id as `metadata.workspace_id` at checkout
  // creation time. Without it, we cannot route the subscription to
  // a workspace — log and skip.
  const workspaceId = sub.metadata?.workspace_id;
  if (!workspaceId) {
    console.warn(
      "[stripe webhook] subscription without workspace_id metadata",
      sub.id,
    );
    return;
  }

  // Resolve tier from the first item's price.
  const item = sub.items.data[0];
  const priceId = item?.price?.id;
  if (!priceId) {
    console.warn("[stripe webhook] subscription has no price id", sub.id);
    return;
  }
  const tier = priceToTier(priceId);
  if (!tier) {
    console.warn("[stripe webhook] unknown price id", priceId);
    return;
  }

  await db.transaction(async (tx) => {
    // Upsert subscriptions row keyed by (provider, provider_subscription_id).
    const [existing] = await tx
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, workspaceId))
      .limit(1);

    const subItem = sub.items.data[0];
    const periodStart = subItem?.current_period_start
      ? new Date(subItem.current_period_start * 1000)
      : null;
    const periodEnd = subItem?.current_period_end
      ? new Date(subItem.current_period_end * 1000)
      : null;
    const status = sub.status as
      | "active"
      | "past_due"
      | "canceled"
      | "trialing";

    if (existing) {
      await tx
        .update(subscriptions)
        .set({
          provider: "stripe",
          providerCustomerId:
            typeof sub.customer === "string" ? sub.customer : sub.customer.id,
          providerSubscriptionId: sub.id,
          tier,
          status,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, existing.id));
    } else {
      await tx.insert(subscriptions).values({
        workspaceId,
        provider: "stripe",
        providerCustomerId:
          typeof sub.customer === "string" ? sub.customer : sub.customer.id,
        providerSubscriptionId: sub.id,
        tier,
        status,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
      });
    }

    // Refresh cached member_limit on workspaces row from new tier.
    await tx
      .update(workspaces)
      .set({
        tier,
        memberLimit: TIER_LIMITS[tier as WorkspaceTier].memberLimit,
        updatedAt: new Date(),
      })
      .where(eq(workspaces.id, workspaceId));
  });
}

async function handleSubscriptionDeleted(
  sub: Stripe.Subscription,
): Promise<void> {
  const workspaceId = sub.metadata?.workspace_id;
  if (!workspaceId) return;

  await db.transaction(async (tx) => {
    await tx
      .update(subscriptions)
      .set({ status: "canceled", updatedAt: new Date() })
      .where(eq(subscriptions.workspaceId, workspaceId));

    // Revert workspace to Free tier — billing membership ended.
    const tier: WorkspaceTier = "free";
    await tx
      .update(workspaces)
      .set({
        tier,
        memberLimit: TIER_LIMITS[tier].memberLimit,
        updatedAt: new Date(),
      })
      .where(eq(workspaces.id, workspaceId));
  });
}

async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  // Use type assertion — Stripe invoice's `subscription` is typed
  // narrower across SDK versions; we only need its id.
  const sub = (invoice as unknown as { subscription?: string | null })
    .subscription;
  if (!sub) return;
  await db
    .update(subscriptions)
    .set({ status: "past_due", updatedAt: new Date() })
    .where(eq(subscriptions.providerSubscriptionId, sub));
}
