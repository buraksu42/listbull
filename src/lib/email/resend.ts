/**
 * Resend wrapper for transactional email (Phase 6.5).
 *
 * Lazy init; when RESEND_API_KEY / RESEND_FROM are unset, sendEmail
 * returns ok:false with reason 'not_configured' and the caller
 * skips silently — operator delivery path still works.
 */
import "server-only";

import { Resend } from "resend";

import { env } from "@/lib/env";

let cached: Resend | null = null;

function getResend(): Resend | null {
  if (cached) return cached;
  if (!env.RESEND_API_KEY) return null;
  cached = new Resend(env.RESEND_API_KEY);
  return cached;
}

export type SendEmailInput = {
  to: string;
  subject: string;
  /** Plain-text body. We don't ship HTML for license email — keeps
   *  the surface tiny + avoids template-injection concerns. */
  text: string;
};

export type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; reason: "not_configured" | "send_failed"; detail?: string };

export async function sendEmail(
  input: SendEmailInput,
): Promise<SendEmailResult> {
  const client = getResend();
  if (!client || !env.RESEND_FROM) {
    return { ok: false, reason: "not_configured" };
  }
  try {
    const { data, error } = await client.emails.send({
      from: env.RESEND_FROM,
      to: input.to,
      subject: input.subject,
      text: input.text,
    });
    if (error) {
      return {
        ok: false,
        reason: "send_failed",
        detail: error.message ?? String(error),
      };
    }
    return { ok: true, id: data?.id ?? "" };
  } catch (err) {
    return {
      ok: false,
      reason: "send_failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
