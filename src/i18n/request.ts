/**
 * next-intl per-request configuration.
 *
 * Phase 17 chat-only pivot removed the Mini App + the session cookie
 * layer that fed it, so there is no authenticated request context on
 * the public site. Locale resolution falls back to the `NEXT_LOCALE`
 * cookie (set by any client that needs to switch) and finally to the
 * default.
 *
 * Bot replies do their own locale handling via `users.locale` read
 * directly inside handlers — this `request.ts` only governs the
 * marketing route group.
 */
import "server-only";

import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  type AppLocale,
} from "@/i18n/routing";

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  const messages = (await import(`../../messages/${locale}.json`)).default;
  return {
    locale,
    messages,
  };
});

async function resolveLocale(): Promise<AppLocale> {
  try {
    const cookieStore = await cookies();
    const fromCookie = cookieStore.get("NEXT_LOCALE")?.value;
    if (isSupportedLocale(fromCookie)) return fromCookie;
  } catch {
    // ignore — cookies() may throw outside a request context
  }
  return DEFAULT_LOCALE;
}
