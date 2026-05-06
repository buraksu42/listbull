/**
 * Iyzico signature verification + tier mapping + Phase 5 SDK
 * wrapper. Iyzipay ships untyped; types live in
 * `src/types/iyzipay.d.ts`.
 *
 * Iyzico signs webhook payloads with HMAC-SHA256 of
 *   `{IYZICO_SECRET_KEY}{requestBody}`
 * encoded base64. Our verify just rebuilds the digest and
 * timing-safe compares.
 */
import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import Iyzipay from "iyzipay";

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

// ─── Phase 5: Iyzipay SDK wrapper ──────────────────────────────────

let cachedClient: Iyzipay | null = null;

export function getIyzipay(): Iyzipay | null {
  if (cachedClient) return cachedClient;
  if (
    !env.IYZICO_API_KEY ||
    !env.IYZICO_SECRET_KEY ||
    !env.IYZICO_BASE_URL
  ) {
    return null;
  }
  cachedClient = new Iyzipay({
    uri: env.IYZICO_BASE_URL,
    apiKey: env.IYZICO_API_KEY,
    secretKey: env.IYZICO_SECRET_KEY,
  });
  return cachedClient;
}

/**
 * Initialize a hosted-checkout subscription form. Returns the token
 * URL the Mini App redirects to; Iyzico hosts the form, captures
 * card details, and webhooks us on subscription state changes.
 *
 * `pricingPlanReferenceCode` is the Iyzico-side plan ID — operator
 * creates plans in Iyzico dashboard during Phase 5 setup, then
 * configures `IYZICO_PLAN_TEAM` / `IYZICO_PLAN_WORKSPACE` env (added
 * in Phase 5 deploy).
 */
export type CreateIyzicoCheckoutInput = {
  pricingPlanReferenceCode: string;
  conversationId: string;
  callbackUrl: string;
  customer: {
    name: string;
    surname: string;
    email: string;
    city: string;
    address: string;
    country: string;
  };
};

export async function createIyzicoCheckout(
  input: CreateIyzicoCheckoutInput,
): Promise<
  | { ok: true; token: string; tokenExpireTime: number; referenceCode: string }
  | { ok: false; reason: string }
> {
  const client = getIyzipay();
  if (!client) {
    return { ok: false, reason: "iyzico_not_configured" };
  }

  return await new Promise((resolve) => {
    client.subscriptionCheckoutForm.initialize(
      {
        locale: "tr",
        conversationId: input.conversationId,
        pricingPlanReferenceCode: input.pricingPlanReferenceCode,
        callbackUrl: input.callbackUrl,
        subscriptionInitialStatus: "ACTIVE",
        customer: {
          name: input.customer.name,
          surname: input.customer.surname,
          email: input.customer.email,
          billingAddress: {
            contactName: `${input.customer.name} ${input.customer.surname}`,
            city: input.customer.city,
            country: input.customer.country,
            address: input.customer.address,
          },
        },
      },
      (err, result) => {
        if (err) {
          resolve({ ok: false, reason: err.message });
          return;
        }
        if (result.status !== "success") {
          resolve({
            ok: false,
            reason: result.errorMessage ?? result.errorCode ?? "iyzico_failure",
          });
          return;
        }
        if (!result.token) {
          resolve({ ok: false, reason: "missing_token" });
          return;
        }
        resolve({
          ok: true,
          token: result.token,
          tokenExpireTime: result.tokenExpireTime ?? 0,
          referenceCode: result.referenceCode ?? "",
        });
      },
    );
  });
}

/**
 * Map Iyzico's `iyziEventType` strings to our internal
 * subscription status values. Iyzico events arrive as upper-snake
 * (e.g. SUBSCRIPTION_ORDER_PAID); we normalize to our enum.
 *
 * Subset: events the upsert handler cares about. Other events are
 * logged + ignored.
 */
export function iyzicoEventToStatus(
  eventType: string,
): "active" | "past_due" | "canceled" | null {
  switch (eventType) {
    case "SUBSCRIPTION_ORDER_PAID":
    case "SUBSCRIPTION_RENEWED":
    case "SUBSCRIPTION_ACTIVATED":
      return "active";
    case "SUBSCRIPTION_ORDER_FAILED":
    case "SUBSCRIPTION_PAYMENT_FAILED":
      return "past_due";
    case "SUBSCRIPTION_CANCELED":
    case "SUBSCRIPTION_EXPIRED":
      return "canceled";
    default:
      return null;
  }
}

/**
 * Iyzico plan reference codes per tier. Operator configures these
 * env vars during Phase 5 setup after creating the plans in the
 * Iyzico dashboard.
 */
export function iyzicoPlanForTier(
  tier: "team" | "workspace",
): string | null {
  if (tier === "team") return env.IYZICO_PLAN_TEAM ?? null;
  if (tier === "workspace") return env.IYZICO_PLAN_WORKSPACE ?? null;
  return null;
}
