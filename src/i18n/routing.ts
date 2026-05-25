/**
 * next-intl routing config — minimal surface.
 *
 * URLs do NOT carry a locale prefix; the bot stores `users.locale`
 * server-side and the marketing surface is English-only. Consumers
 * (request handler, future language switchers) import from this
 * file so the supported-locale tuple stays single-sourced.
 */
export const SUPPORTED_LOCALES = ["tr", "en"] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = "en";

export function isSupportedLocale(value: unknown): value is AppLocale {
  return value === "tr" || value === "en";
}
