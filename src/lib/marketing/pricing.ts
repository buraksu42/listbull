import { headers } from "next/headers";

/**
 * Server-side currency selector for the marketing landing pricing
 * grid. Reads `Accept-Language` (server-resolved); defaults to TRY
 * for `tr-*` locales, USD otherwise.
 *
 * Pure server-only — never inferred client-side because that would
 * cause a hydration mismatch between SSR + client render.
 */
export async function detectMarketingCurrency(): Promise<"TRY" | "USD"> {
  const h = await headers();
  const acceptLang = h.get("accept-language") ?? "";
  const primary = acceptLang.split(",")[0]?.trim().toLowerCase() ?? "";
  if (primary.startsWith("tr")) return "TRY";
  return "USD";
}
