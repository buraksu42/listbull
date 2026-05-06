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
import { issueLicense } from "@/lib/billing/license";
import { priceToTier, verifyStripeWebhook } from "@/lib/billing/stripe";
import { db } from "@/lib/db/client";
import { subscriptions, workspaces } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email/resend";
import { env } from "@/lib/env";
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
      case "invoice.payment_succeeded":
        // Phase 6.5: self-host SKU one-time payments fire this with
        // a price ID matching STRIPE_PRICE_SELFHOST_*. Subscription
        // SKUs also fire it but we ignore those here (the
        // subscription.created/updated handlers already wrote the
        // subscriptions row). Self-host check first — if no
        // self-host price match, no-op.
        await maybeIssueSelfHostLicense(event.data.object);
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

/**
 * Phase 6.5: auto-issue a self-host license JWT when an
 * invoice.payment_succeeded event matches one of the
 * `STRIPE_PRICE_SELFHOST_*` price IDs. Skips silently when:
 *   - LICENSE_PRIVATE_KEY is unset (issuer not configured)
 *   - the invoice's price doesn't match a self-host SKU
 *   - the invoice has no email + workspace_id metadata
 *
 * The `metadata.workspaces` field on the Checkout Session is a
 * comma-separated list of workspace_ids the license should
 * authorize. Defaults to a single fresh UUID if absent — the
 * licensee can re-target via reissue.
 */
async function maybeIssueSelfHostLicense(
  invoice: Stripe.Invoice,
): Promise<void> {
  if (!env.LICENSE_PRIVATE_KEY) return;

  // Find the line item's price ID. Stripe.Invoice.lines.data[0].price
  // is the canonical surface for one-time payments.
  type InvoiceLine = {
    price?: { id?: string } | null;
  };
  const lines = (invoice as unknown as { lines?: { data?: InvoiceLine[] } })
    .lines?.data ?? [];
  const priceId = lines[0]?.price?.id;
  if (!priceId) return;

  let tier: "team" | "workspace" | null = null;
  if (priceId === env.STRIPE_PRICE_SELFHOST_TEAM) tier = "team";
  else if (priceId === env.STRIPE_PRICE_SELFHOST_WORKSPACE)
    tier = "workspace";
  if (!tier) return; // Not a self-host SKU; ignore.

  const meta =
    (invoice as unknown as { metadata?: Record<string, string> })
      .metadata ?? {};
  const email =
    typeof meta.email === "string" && meta.email.length > 0
      ? meta.email
      : (invoice as unknown as { customer_email?: string | null })
          .customer_email ?? "";
  if (!email) {
    console.warn(
      "[stripe webhook] self-host invoice has no email; skipping license issuance",
      { priceId },
    );
    return;
  }

  const workspaceCsv = typeof meta.workspaces === "string" ? meta.workspaces : "";
  const workspaceIds =
    workspaceCsv.length > 0
      ? workspaceCsv.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
      : [crypto.randomUUID()];

  const seats = tier === "team" ? 5 : 15;

  const result = await issueLicense({
    tier,
    seats,
    email,
    workspaces: workspaceIds,
    sourceProvider: "stripe",
    sourceReference: invoice.id,
  });
  if (!result.ok) {
    console.error(
      "[stripe webhook] auto-issuance failed",
      result.reason,
      { priceId, email },
    );
    return;
  }

  // Best-effort email delivery; same template as the manual issuance
  // route. Operator inspects logs if delivery fails.
  await sendEmail({
    to: email,
    subject: "Your listbull self-host license",
    text:
      `Hi,\n\n` +
      `Thanks for your purchase. Your listbull ${tier}-tier ` +
      `license is ready.\n\n` +
      `License key (paste into LICENSE_KEY env on your self-host instance):\n\n` +
      `${result.jwt}\n\n` +
      `Set LICENSE_VERIFY_ENABLED=true and restart your container ` +
      `to activate.\n\n— listbull`,
  });
}
