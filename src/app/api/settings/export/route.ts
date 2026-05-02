/**
 * `POST /api/settings/export` — Phase 4 / F1.
 *
 * Auth-gated. Generates the caller's `ExportBundle` (Inv-20: caller-only
 * filter) and returns either:
 *   - `{ mode: "url", url, expiresAt, filename }` — when Hetzner Object
 *     Storage is configured (24h pre-signed URL).
 *   - `{ mode: "inline", url: data:..., filename, bundle }` — fallback
 *     for self-host operators with no Object Storage.
 *
 * The fallback embeds the bundle directly so the Frontend can let the
 * user save without a second round-trip. Both modes use the same
 * filename convention: `listgram-export-<userId>-<isoDate>.json`.
 *
 * Inv-20: encrypted API key + session cookies + other users' content
 * are excluded — see `src/lib/server/export.ts`.
 *
 * Phase 5+ upgrade path: when export volume strains the route handler's
 * memory, switch to a streaming Node response or a queue. The
 * `ExportBundle` shape stays stable.
 */
import { NextResponse } from "next/server";

import { getSessionUserId } from "@/lib/auth/session";
import { generateExportBundle } from "@/lib/server/export";
import {
  objectStorageConfigured,
  uploadAndPresign,
} from "@/lib/server/object-storage";
import type { ExportResponse } from "@/lib/validators/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "unauthorized", message: "Sign in via Telegram" },
      },
      { status: 401 },
    );
  }

  const bundle = await generateExportBundle(userId);
  const isoDate = bundle.generatedAt.slice(0, 10);
  const filename = `listgram-export-${userId}-${isoDate}.json`;

  const json = JSON.stringify(bundle);
  const buf = Buffer.from(json, "utf8");

  // Object Storage path (best effort).
  if (objectStorageConfigured()) {
    const key = `exports/${userId}/${bundle.generatedAt.replace(/[:.]/g, "-")}.json`;
    const uploaded = await uploadAndPresign(key, buf, "application/json");
    if (uploaded) {
      const data: ExportResponse = {
        mode: "url",
        url: uploaded.url,
        expiresAt: uploaded.expiresAt,
        filename,
      };
      return NextResponse.json({ ok: true, data });
    }
    // Upload failed — fall through to inline mode.
  }

  // Inline data-URL fallback.
  const dataUrl = `data:application/json;base64,${buf.toString("base64")}`;
  const data: ExportResponse = {
    mode: "inline",
    url: dataUrl,
    filename,
    bundle,
  };
  return NextResponse.json({ ok: true, data });
}
