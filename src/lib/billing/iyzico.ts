/**
 * Iyzico signature verification + tier mapping. Phase 4.5 ships
 * signature verification only; the SDK-driven checkout flow lands
 * Phase 5 with `iyzipay-node`.
 *
 * Iyzico signs webhook payloads with HMAC-SHA256 of
 *   `{IYZICO_SECRET_KEY}{requestBody}`
 * encoded base64. Our verify just rebuilds the digest and
 * timing-safe compares.
 */
import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";

export type IyzicoEvent = {
  /** Iyzico subscription / checkout reference id. */
  referenceCode: string;
  /** e.g. "SUBSCRIPTION_ORDER_PAID", "SUBSCRIPTION_ORDER_FAILED". */
  iyziEventType: string;
  /** ISO 8601 UTC. */
  iyziEventTime: string;
  /** Reference to our internal workspace (we set this at checkout). */
  conversationId?: string;
  /** Raw payload — caller can re-parse for event-specific fields. */
  raw: unknown;
};

/**
 * Verify the `x-iyz-signature` (or whatever header Iyzico picked)
 * against the raw request body. Returns null when secret is unset
 * (Phase 4.5 self-host without Iyzico) or signature mismatch.
 */
export function verifyIyzicoWebhook(
  rawBody: string,
  signatureHeader: string | null,
): IyzicoEvent | null {
  if (!env.IYZICO_WEBHOOK_SECRET || !signatureHeader) return null;

  const expected = createHmac("sha256", env.IYZICO_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("base64");

  // timingSafeEqual requires equal-length buffers.
  const a = Buffer.from(signatureHeader, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    return {
      referenceCode: String(parsed.referenceCode ?? ""),
      iyziEventType: String(parsed.iyziEventType ?? ""),
      iyziEventTime: String(parsed.iyziEventTime ?? new Date().toISOString()),
      conversationId:
        typeof parsed.conversationId === "string"
          ? parsed.conversationId
          : undefined,
      raw: parsed,
    };
  } catch {
    return null;
  }
}
