"use client";

import { useEffect } from "react";

import type { TelegramMainButton } from "@/lib/telegram/webapp-types";

type Options = {
  /** Show/hide the MainButton. Hide when the form isn't in a save-able state. */
  visible: boolean;
  /** Button label. Mirrors form intent ("Save", "Add", "Share"). */
  text: string;
  /** Click handler — typically the form submit. */
  onClick: () => void;
  /** When true, button is rendered but click is a no-op (greyed). */
  disabled?: boolean;
  /** Show the spinner (Telegram-native progress indicator) while saving. */
  loading?: boolean;
};

/**
 * Wires the form lifecycle to Telegram.WebApp.MainButton. Call from a
 * client component; the hook handles show/hide/enable/disable + click
 * binding/unbinding on every dependency change.
 *
 * The hook is a no-op on non-Telegram surfaces (e.g. local dev in Chrome
 * without the WebApp script) so screens still render.
 */
export function useTelegramMainButton({
  visible,
  text,
  onClick,
  disabled = false,
  loading = false,
}: Options) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const button: TelegramMainButton | undefined =
      window.Telegram?.WebApp?.MainButton;
    if (!button) return;

    button.setText?.(text);

    if (loading) {
      button.showProgress?.(true);
    } else {
      button.hideProgress?.();
    }

    if (disabled) {
      button.disable?.();
    } else {
      button.enable?.();
    }

    button.onClick?.(onClick);

    if (visible) {
      button.show?.();
    } else {
      button.hide?.();
    }

    return () => {
      button.offClick?.(onClick);
      button.hide?.();
      button.hideProgress?.();
    };
  }, [visible, text, onClick, disabled, loading]);
}
