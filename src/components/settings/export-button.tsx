"use client";

import { Download } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { ApiError } from "@/lib/api-client";

/**
 * F1 — "Download my data" trigger.
 *
 * Backend's `GET /api/settings/export` streams the JSON bundle directly
 * with `Content-Disposition: attachment; filename=...` so the simplest,
 * most reliable trigger is a regular `<a href>` click. We use fetch +
 * Blob to (a) surface error envelopes via toast (vs. a broken file
 * download), (b) keep a spinner while the bundle assembles, and (c) keep
 * the filename intact even when the response uses a relative URL.
 *
 * The Architect spec also leaves room for the response to be a
 * `{ url, expiresAt }` shape (Object Storage upgrade path) — this
 * implementation handles both shapes by content-type detection.
 *
 * a11y: button has `aria-busy` while the request is in flight; toasts
 * announce success/failure for screen readers via `aria-live="polite"`
 * on the sonner root (already wired Phase 1).
 */
type ExportButtonProps = {
  label: string;
  pendingLabel: string;
  successMessage: string;
  failureMessage: string;
};

type SignedUrlResponse = {
  url: string;
  expiresAt?: string;
  filename?: string;
};

export function ExportButton({
  label,
  pendingLabel,
  successMessage,
  failureMessage,
}: ExportButtonProps) {
  const [pending, setPending] = React.useState(false);

  const handleClick = React.useCallback(async () => {
    if (pending) return;
    setPending(true);
    try {
      const res = await fetch("/api/settings/export", {
        method: "GET",
        credentials: "include",
        headers: { accept: "application/json" },
      });
      if (!res.ok) {
        // Try to surface the typed error envelope.
        let code = "http_error";
        let message = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as
            | { ok: false; error: { code: string; message: string } }
            | unknown;
          if (
            body &&
            typeof body === "object" &&
            "ok" in body &&
            (body as { ok: unknown }).ok === false &&
            "error" in body
          ) {
            const err = (body as { error: { code: string; message: string } })
              .error;
            code = err.code;
            message = err.message;
          }
        } catch {
          /* ignore — non-JSON */
        }
        throw new ApiError(code, message, res.status);
      }

      const contentType = res.headers.get("content-type") ?? "";
      const dispositionFilename = parseDispositionFilename(
        res.headers.get("content-disposition"),
      );

      // Branch on response shape: signed URL ({ url }) vs. direct file.
      if (contentType.includes("application/json") && !dispositionFilename) {
        const body = (await res.json()) as
          | { ok: true; data: SignedUrlResponse }
          | { ok: false; error: { code: string; message: string } }
          | SignedUrlResponse;
        const data: SignedUrlResponse = unwrapEnvelope(body);
        if (!data.url) {
          throw new ApiError(
            "invalid_response",
            "Export response missing url",
            500,
          );
        }
        triggerDownload(data.url, data.filename);
      } else {
        // Direct file response (default Phase 4 shape).
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        triggerDownload(
          url,
          dispositionFilename ?? defaultExportFilename(),
        );
        // Defer revoke so the click navigation actually fires first.
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }

      toast.success(successMessage);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "unknown";
      const msg =
        err instanceof Error && err.message
          ? translateExportError(code, err.message, failureMessage)
          : failureMessage;
      toast.error(msg);
    } finally {
      setPending(false);
    }
  }, [pending, successMessage, failureMessage]);

  return (
    <Button
      type="button"
      variant="secondary"
      onClick={handleClick}
      disabled={pending}
      aria-busy={pending || undefined}
    >
      <Download className="h-4 w-4" aria-hidden />
      {pending ? pendingLabel : label}
    </Button>
  );
}

function unwrapEnvelope(body: unknown): SignedUrlResponse {
  if (
    body &&
    typeof body === "object" &&
    "ok" in body &&
    (body as { ok: unknown }).ok === true &&
    "data" in body
  ) {
    return (body as { data: SignedUrlResponse }).data;
  }
  return body as SignedUrlResponse;
}

function triggerDownload(href: string, filename: string | undefined) {
  const a = document.createElement("a");
  a.href = href;
  if (filename) a.download = filename;
  a.rel = "noopener";
  // Firefox requires the element to be in the DOM at click time.
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function parseDispositionFilename(value: string | null): string | undefined {
  if (!value) return undefined;
  // Match either filename*=UTF-8''... or plain filename="...".
  const utf = /filename\*=UTF-8''([^;]+)/i.exec(value);
  if (utf?.[1]) {
    try {
      return decodeURIComponent(utf[1]);
    } catch {
      /* fallthrough */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(value);
  return plain?.[1];
}

function defaultExportFilename(): string {
  const iso = new Date().toISOString().slice(0, 10);
  return `listgram-export-${iso}.json`;
}

function translateExportError(
  code: string,
  fallbackMessage: string,
  defaultMessage: string,
): string {
  switch (code) {
    case "unauthorized":
      return defaultMessage;
    case "rate_limited":
      return "Too many requests — try again in a minute.";
    default:
      return fallbackMessage || defaultMessage;
  }
}
