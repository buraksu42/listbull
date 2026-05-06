"use client";

import { useEffect } from "react";

import { attachTelegramThemeAdapter } from "@/lib/telegram/theme-adapter";

export function TelegramThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    return attachTelegramThemeAdapter();
  }, []);

  return <>{children}</>;
}
