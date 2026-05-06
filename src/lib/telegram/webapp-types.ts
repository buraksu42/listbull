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

/**
 * Telegram WebApp MainButton — the system button at the bottom of the
 * Mini App viewport. We use it as the form-save affordance on the
 * Settings and Item-Edit screens (see design.md "Telegram MainButton").
 */
export type TelegramMainButton = {
  text?: string;
  isVisible?: boolean;
  isActive?: boolean;
  isProgressVisible?: boolean;
  show?: () => void;
  hide?: () => void;
  enable?: () => void;
  disable?: () => void;
  showProgress?: (leaveActive?: boolean) => void;
  hideProgress?: () => void;
  setText?: (text: string) => void;
  onClick?: (cb: () => void) => void;
  offClick?: (cb: () => void) => void;
  setParams?: (params: {
    text?: string;
    color?: string;
    text_color?: string;
    is_active?: boolean;
    is_visible?: boolean;
  }) => void;
};

export type TelegramBackButton = {
  isVisible?: boolean;
  show?: () => void;
  hide?: () => void;
  onClick?: (cb: () => void) => void;
  offClick?: (cb: () => void) => void;
};

/**
 * Subset of `initDataUnsafe` we read for routing. Telegram populates
 * `start_param` from the `?startapp=<param>` portion of a t.me link
 * (or the `?start=<param>` portion when the bot was started in DM).
 */
export type TelegramInitDataUnsafe = {
  start_param?: string;
};

export type TelegramWebApp = {
  initData?: string;
  initDataUnsafe?: TelegramInitDataUnsafe;
  themeParams?: TelegramThemeParams;
  colorScheme?: TelegramColorScheme;
  ready?: () => void;
  expand?: () => void;
  onEvent?: (event: "themeChanged", handler: () => void) => void;
  offEvent?: (event: "themeChanged", handler: () => void) => void;
  MainButton?: TelegramMainButton;
  BackButton?: TelegramBackButton;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}
