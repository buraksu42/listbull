/**
 * next-intl per-request configuration.
 *
 * Locale is read from `users.locale` server-side; if no session exists
 * (e.g. marketing surface, public snapshot page), fall back to "en".
 *
 * Per the project's "no path prefix" decision (handoff/specs/CLAUDE.md),
 * URLs stay clean and locale is data-driven rather than route-driven.
 */
import "server-only";

import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { getSessionUserId } from "@/lib/auth/session";
import { eq } from "drizzle-orm";

/**
 * Locale set + helpers — kept in `./routing.ts` for the canonical export
 * point. Re-imported here for the in-file resolver.
 */
import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  type AppLocale,
} from "@/i18n/routing";

/**
 * Resolve the active locale for the current request.
 *
 * Order of precedence:
 *   1. Authenticated user's `users.locale` (Mini App primary signal).
 *   2. `NEXT_LOCALE` cookie (set by clients that need to switch before
 *      session is available — e.g. setup wizard).
 *   3. DEFAULT_LOCALE.
 *
 * Catalogs are loaded eagerly; both are small (<10kb each) so the cost
 * of importing both is negligible compared to the savings of a single
 * resolve path.
 */
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
    const userId = await getSessionUserId();
    if (userId) {
      const row = await db
        .select({ locale: users.locale })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (row[0] && isSupportedLocale(row[0].locale)) {
        return row[0].locale;
      }
    }
  } catch {
    // Session lookup may fail outside the App router (e.g. middleware
    // pre-render). Fall through to cookie/default.
  }

  try {
    const cookieStore = await cookies();
    const fromCookie = cookieStore.get("NEXT_LOCALE")?.value;
    if (isSupportedLocale(fromCookie)) return fromCookie;
  } catch {
    // ignore
  }

  return DEFAULT_LOCALE;
}
