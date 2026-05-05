/**
 * `POST /api/webhooks/iyzico` — Phase 4.5 skeleton.
 *
 * Verifies HMAC signature, idempotency-checks the event, then logs
 * the event for now. Phase 5 ships the full subscription state
 * upsert mirroring Stripe's handler — Iyzico's subscription lifecycle
 * events (created / paid / failed) map onto the same `subscriptions`
 * table.
 *
 * Iyzico-specific rules (Phase 5 implementation):
 *  - Events arrive with `referenceCode` (subscription) +
 *    `iyziEventType` ("SUBSCRIPTION_ORDER_PAID" etc).
 *  - Conversation_id at checkout time MUST be `workspace:<uuid>` so
 *    we can route the event back to a workspace.
 */
import { NextResponse } from "next/server";

import { isReplay } from "@/lib/billing/idempotency";
import { verifyIyzicoWebhook } from "@/lib/billing/iyzico";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rawBody = await request.text();
  // Iyzico's signature header name varies by integration; accept the
  // common ones.
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

  const eventId = `${event.referenceCode}:${event.iyziEventTime}`;
  if (isReplay(eventId)) {
    return NextResponse.json({ ok: true, replayed: true });
  }

  // Phase 4.5: log + acknowledge. Phase 5 wires real subscription
  // upserts (mirror Stripe handler shape).
  console.log(
    "[iyzico webhook] received",
    JSON.stringify({
      type: event.iyziEventType,
      referenceCode: event.referenceCode,
      conversationId: event.conversationId,
    }),
  );

  return NextResponse.json({ ok: true, phase4_5_logged: true });
}
