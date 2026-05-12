import Script from "next/script";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

import { TelegramBackButton } from "@/components/telegram/back-button";
import { HomeFab } from "@/components/telegram/home-fab";
import { QueryProvider } from "@/components/telegram/query-provider";
import { TelegramThemeProvider } from "@/components/telegram/theme-provider";
import { Toaster } from "@/components/ui/sonner";

export const metadata = {
  robots: { index: false, follow: false },
};

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Server-resolved locale + catalog from `src/i18n/request.ts`.
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <>
      {/* Telegram WebApp SDK — must load before client adapter runs. */}
      <Script
        src="https://telegram.org/js/telegram-web-app.js"
        strategy="beforeInteractive"
      />
      <NextIntlClientProvider locale={locale} messages={messages}>
        <QueryProvider>
          <TelegramThemeProvider>
            <TelegramBackButton />
            <div
              className="min-h-dvh"
              style={{
                background: "var(--lb-bg)",
                color: "var(--lb-fg)",
              }}
            >
              {children}
            </div>
            <HomeFab />
            <Toaster />
          </TelegramThemeProvider>
        </QueryProvider>
      </NextIntlClientProvider>
    </>
  );
}
