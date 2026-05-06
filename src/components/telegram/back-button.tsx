"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Wires the Telegram WebApp BackButton to Next.js router.back() on every
 * route except `/lists` (the Mini App's nominal root). Hidden on root
 * because Telegram's own back arrow already closes the WebApp there.
 */
type BackButtonHandle = {
  show?: () => void;
  hide?: () => void;
  onClick?: (cb: () => void) => void;
  offClick?: (cb: () => void) => void;
};

type WindowWithTelegram = Window & {
  Telegram?: { WebApp?: { BackButton?: BackButtonHandle } };
};

export function TelegramBackButton() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const w = window as WindowWithTelegram;
    const back = w.Telegram?.WebApp?.BackButton;
    if (!back) return;

    const isRoot = pathname === "/lists" || pathname === "/" || pathname === "/app";

    const onClick = () => {
      router.back();
    };

    if (isRoot) {
      back.hide?.();
      return;
    }

    back.show?.();
    back.onClick?.(onClick);

    return () => {
      back.offClick?.(onClick);
      back.hide?.();
    };
  }, [pathname, router]);

  return null;
}
