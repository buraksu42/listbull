/**
 * next-intl routing config — minimal surface.
 *
 * The project does NOT prefix URLs with the locale (clean URL convention,
 * see `handoff/specs/CLAUDE.md`). We expose only the supported locale
 * tuple and the default; consumers (request handler, language switcher)
 * import from here so the source of truth stays single.
 */
export const SUPPORTED_LOCALES = ["tr", "en"] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = "en";

export function isSupportedLocale(value: unknown): value is AppLocale {
  return value === "tr" || value === "en";
}
