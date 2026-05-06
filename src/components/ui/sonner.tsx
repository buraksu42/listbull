"use client";

import { Toaster as SonnerToaster } from "sonner";

/**
 * Toaster wrapper — top-center per design.md. Style overrides keep toasts
 * legible against both light and dark Telegram themes.
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="top-center"
      theme="system"
      toastOptions={{
        style: {
          background: "var(--lb-card)",
          color: "var(--lb-card-fg)",
          border: "1px solid var(--lb-border)",
        },
      }}
    />
  );
}

export { toast } from "sonner";
