/**
 * Stripe client wrapper. Phase 4.5: webhook event verification +
 * checkout session creation skeleton. Phase 5: customer portal,
 * subscription lifecycle webhook handlers wire to subscriptions
 * table.
 *
 * Stripe SDK is initialized LAZILY because not every deploy
 * (self-host) configures Stripe keys. Routes that need it call
 * `getStripe()` and 503 if it returns null.
 */
import "server-only";

import Stripe from "stripe";

import { env } from "@/lib/env";

let cached: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (cached) return cached;
  if (!env.STRIPE_SECRET_KEY) return null;
  cached = new Stripe(env.STRIPE_SECRET_KEY, {
    // Pin to the SDK's published API version — the SDK rejects any
    // other string at typecheck. Bumping the Stripe SDK is the only
    // way to update this.
    apiVersion: "2026-04-22.dahlia",
    typescript: true,
  });
  return cached;
}

/**
 * Verify a Stripe webhook payload + construct the typed event. Returns
 * null when the signature header is missing or invalid; never throws
 * (route handler returns 400 / 401 based on the null reason).
 *
 * The raw body MUST be passed exactly as received — Next.js's
 * Request.text() is fine; Request.json() loses bytes the verifier
 * needs.
 */
export function verifyStripeWebhook(
  rawBody: string,
  signatureHeader: string | null,
): Stripe.Event | null {
  const stripe = getStripe();
  if (!stripe || !env.STRIPE_WEBHOOK_SECRET || !signatureHeader) return null;
  try {
    return stripe.webhooks.constructEvent(
      rawBody,
      signatureHeader,
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    console.warn(
      "[stripe] webhook signature verification failed",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Map a Stripe Price ID to our internal tier. Returns null on miss
 * — caller surfaces as `unknown_price` and ignores the event.
 */
export function priceToTier(priceId: string): "team" | "workspace" | null {
  if (priceId === env.STRIPE_PRICE_TEAM) return "team";
  if (priceId === env.STRIPE_PRICE_WORKSPACE) return "workspace";
  return null;
}
