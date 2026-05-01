/**
 * Minimal subset of Telegram.WebApp surface we use across the Mini App.
 * The real type lives in @telegram-apps/sdk-react; we keep a slim shape here
 * so simple boot pages don't need the SDK.
 */
export type TelegramThemeParams = {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
};

export type TelegramColorScheme = "light" | "dark";

export type TelegramWebApp = {
  initData?: string;
  themeParams?: TelegramThemeParams;
  colorScheme?: TelegramColorScheme;
  ready?: () => void;
  expand?: () => void;
  onEvent?: (event: "themeChanged", handler: () => void) => void;
  offEvent?: (event: "themeChanged", handler: () => void) => void;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}
