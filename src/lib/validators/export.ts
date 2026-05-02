/**
 * F1 — export endpoint typed shapes (Phase 4).
 *
 * The bundle itself lives in `src/lib/types/index.ts` (`ExportBundle`)
 * since it's a wire shape. This module re-exports it for client typing
 * + adds the route-specific response envelope.
 */
import type { ExportBundle } from "@/lib/types";

export type { ExportBundle } from "@/lib/types";

/**
 * Response shape of `POST /api/settings/export`. Two delivery modes:
 *
 *   - "url" → upload landed in Hetzner Object Storage; client downloads
 *     from `url` (24h pre-signed).
 *   - "inline" → data URL fallback (no Object Storage configured); the
 *     client triggers a download via `<a download href="...">`.
 */
export type ExportResponse =
  | {
      mode: "url";
      url: string;
      /** ISO 8601 — when the signed URL expires. */
      expiresAt: string;
      /** Suggested filename for the client's download attribute. */
      filename: string;
    }
  | {
      mode: "inline";
      /** `data:application/json;base64,<...>` — usable directly as href. */
      url: string;
      filename: string;
      bundle: ExportBundle;
    };
