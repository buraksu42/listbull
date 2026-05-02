import type {
  TelegramColorScheme,
  TelegramThemeParams,
} from "@/lib/telegram/webapp-types";

/**
 * Bridge Telegram WebApp theme params into our --lb-* CSS custom properties.
 * The mark stays brand-teal across both modes; everything else inherits Telegram's palette.
 */

function applyParams(
  params: TelegramThemeParams,
  scheme: TelegramColorScheme | undefined,
) {
  const root = document.documentElement;

  if (scheme) root.dataset.theme = scheme;

  if (params.bg_color) root.style.setProperty("--lb-bg", params.bg_color);
  if (params.text_color) root.style.setProperty("--lb-fg", params.text_color);
  if (params.hint_color) root.style.setProperty("--lb-muted-fg", params.hint_color);
  if (params.secondary_bg_color) {
    root.style.setProperty("--lb-card", params.secondary_bg_color);
    root.style.setProperty("--lb-muted", params.secondary_bg_color);
  }
  // link_color intentionally ignored — brand accent is the immovable signal color.
}

/**
 * Wire up theme-adapter on Mini App boot. Returns a cleanup function.
 */
export function attachTelegramThemeAdapter(): () => void {
  const tg = window.Telegram?.WebApp;
  if (!tg) return () => {};

  const apply = () => {
    applyParams(tg.themeParams ?? {}, tg.colorScheme);
  };
  apply();

  if (tg.onEvent) {
    tg.onEvent("themeChanged", apply);
    return () => tg.offEvent?.("themeChanged", apply);
  }
  return () => {};
}
