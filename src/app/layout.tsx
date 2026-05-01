import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "listgram",
  description:
    "Telegram-native AI list assistant with persistent shared list memory. Open source, self-hostable, BYOK.",
  applicationName: "listgram",
  metadataBase:
    process.env.NEXT_PUBLIC_APP_URL && process.env.NEXT_PUBLIC_APP_URL.length > 0
      ? new URL(process.env.NEXT_PUBLIC_APP_URL)
      : undefined,
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
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
