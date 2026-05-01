import Script from "next/script";

import { TelegramBackButton } from "@/components/telegram/back-button";
import { QueryProvider } from "@/components/telegram/query-provider";
import { TelegramThemeProvider } from "@/components/telegram/theme-provider";
import { Toaster } from "@/components/ui/sonner";

export const metadata = {
  robots: { index: false, follow: false },
};

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      {/* Telegram WebApp SDK — must load before client adapter runs. */}
      <Script
        src="https://telegram.org/js/telegram-web-app.js"
        strategy="beforeInteractive"
      />
      <QueryProvider>
        <TelegramThemeProvider>
          <TelegramBackButton />
          <div
            className="min-h-dvh"
            style={{
              background: "var(--lg-bg)",
              color: "var(--lg-fg)",
            }}
          >
            {children}
          </div>
          <Toaster />
        </TelegramThemeProvider>
      </QueryProvider>
    </>
  );
}
