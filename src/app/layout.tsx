import type { Metadata, Viewport } from "next";

import { UmamiAnalytics } from "@/components/UmamiAnalytics";

import "./globals.css";

const isProd = process.env.NEXT_PUBLIC_ENV === "production";

export const metadata: Metadata = {
  title: "listbull",
  description:
    "Telegram-native AI list assistant with persistent shared list memory. Open source, self-hostable, BYOK.",
  applicationName: "listbull",
  metadataBase:
    process.env.NEXT_PUBLIC_APP_URL && process.env.NEXT_PUBLIC_APP_URL.length > 0
      ? new URL(process.env.NEXT_PUBLIC_APP_URL)
      : undefined,
  // Belt-and-suspenders with src/app/robots.ts: anywhere outside production
  // gets a noindex meta even if the robots route is misconfigured. The
  // /ops dashboard has its own noindex via the (ops) layout.
  robots: isProd ? undefined : { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#17212B",
  colorScheme: "light dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh">
        {children}
        <UmamiAnalytics />
      </body>
    </html>
  );
}
