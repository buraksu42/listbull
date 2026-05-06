/**
 * `POST /api/webhooks/iyzico` — Iyzico subscription lifecycle
 * handler. Phase 5 ships full subscription upsert mirroring the
 * Stripe handler shape.
 *
 * Iyzico webhooks deliver `iyziEventType` (e.g. SUBSCRIPTION_ORDER_PAID)
 * and `referenceCode` (the subscription's Iyzico-side ID). We bind a
 * workspace_id to each subscription via `conversationId =
 * "workspace:<uuid>"` set at checkout creation; the webhook reads
 * conversationId on subscriber-create events and persists the link
 * thereafter via `subscriptions.providerSubscriptionId =
 * referenceCode`.
 */
import { NextResponse } from "next/server";

import { eq } from "drizzle-orm";

import { isReplay } from "@/lib/billing/idempotency";
import {
  iyzicoEventToStatus,
  verifyIyzicoWebhook,
} from "@/lib/billing/iyzico";
import { db } from "@/lib/db/client";
import { subscriptions, workspaces } from "@/lib/db/schema";
import { TIER_LIMITS, type WorkspaceTier } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONVERSATION_PREFIX = "workspace:";
const TIER_PREFIX = "tier:";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const sigHeader =
    request.headers.get("x-iyz-signature") ??
    request.headers.get("x-iyzipay-signature");

  const event = verifyIyzicoWebhook(rawBody, sigHeader);
  if (!event) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "invalid_signature", message: "Bad signature" },
      },
      { status: 401 },
    );
  }

  const eventId = `${event.referenceCode}:${event.iyziEventTime}:${event.iyziEventType}`;
  if (isReplay(eventId)) {
    return NextResponse.json({ ok: true, replayed: true });
  }

  const status = iyzicoEventToStatus(event.iyziEventType);
  if (!status) {
    // Logged-but-unhandled event types (e.g. SUBSCRIPTION_UPGRADED).
    console.log(
      "[iyzico webhook] unhandled event",
      event.iyziEventType,
      event.referenceCode,
    );
    return NextResponse.json({ ok: true, ignored: true });
  }

  // Resolve workspace from conversationId. Format set at checkout
  // creation: `workspace:<uuid>|tier:team`.
  const parts = (event.conversationId ?? "").split("|");
  const workspaceIdRaw = parts.find((p) =>
    p.startsWith(CONVERSATION_PREFIX),
  );
  const tierRaw = parts.find((p) => p.startsWith(TIER_PREFIX));
  const workspaceId = workspaceIdRaw?.slice(CONVERSATION_PREFIX.length) ?? "";
  const tier =
    (tierRaw?.slice(TIER_PREFIX.length) as WorkspaceTier | undefined) ??
    null;

  if (!workspaceId) {
    console.warn(
      "[iyzico webhook] missing workspace_id in conversationId",
      event.referenceCode,
    );
    return NextResponse.json({ ok: true, missing_metadata: true });
  }

  try {
    await upsertIyzicoSubscription({
      workspaceId,
      providerSubscriptionId: event.referenceCode,
      tier: tier && (tier === "team" || tier === "workspace") ? tier : null,
      status,
    });
  } catch (err) {
    console.error("[iyzico webhook] upsert threw", err);
    return NextResponse.json(
      {
        ok: false,
        error: { code: "internal_error", message: "Handler failed" },
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

async function upsertIyzicoSubscription(params: {
  workspaceId: string;
  providerSubscriptionId: string;
  tier: "team" | "workspace" | null;
  status: "active" | "past_due" | "canceled";
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: subscriptions.id, tier: subscriptions.tier })
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, params.workspaceId))
      .limit(1);

    // If we don't have a tier from conversationId AND no existing
    // row, we cannot determine which tier to assign. Skip — Iyzico's
    // checkout flow always sets the conversationId, so this only
    // triggers on data-quality issues.
    const effectiveTier =
      params.tier ?? (existing?.tier as WorkspaceTier | undefined);
    if (!effectiveTier) {
      console.warn(
        "[iyzico webhook] no tier inferable for",
        params.workspaceId,
      );
      return;
    }

    if (existing) {
      await tx
        .update(subscriptions)
        .set({
          provider: "iyzico",
          providerCustomerId: params.providerSubscriptionId, // Iyzico bundles customer + sub
          providerSubscriptionId: params.providerSubscriptionId,
          tier: effectiveTier,
          status: params.status,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, existing.id));
    } else {
      await tx.insert(subscriptions).values({
        workspaceId: params.workspaceId,
        provider: "iyzico",
        providerCustomerId: params.providerSubscriptionId,
        providerSubscriptionId: params.providerSubscriptionId,
        tier: effectiveTier,
        status: params.status,
      });
    }

    // Refresh workspace tier cache. On 'canceled' events, revert to
    // free; otherwise honor the inferred tier.
    const workspaceTier: WorkspaceTier =
      params.status === "canceled" ? "free" : effectiveTier;
    await tx
      .update(workspaces)
      .set({
        tier: workspaceTier,
        memberLimit: TIER_LIMITS[workspaceTier].memberLimit,
        updatedAt: new Date(),
      })
      .where(eq(workspaces.id, params.workspaceId));
  });
}
