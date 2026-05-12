import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

import {
  SettingsForm,
  type SettingsInitial,
} from "@/components/settings/settings-form";
import { requireUser } from "@/lib/server/auth/require-user";

export const dynamic = "force-dynamic";

/**
 * Settings page — server-side fetches the user's current preferences via
 * the same `/api/settings` endpoint the client mutates against. We reuse
 * the API on initial load (rather than directly querying the DB here) so
 * the client and server view of the response stays single-source.
 *
 * If the API isn't ready yet (Backend mid-implementation), we fall back
 * to default settings so the form can still render.
 *
 * Phase 4 adds the F1 "Download my data" section below the form.
 */
export default async function SettingsPage() {
  await requireUser();
  const [initial, t] = await Promise.all([
    fetchInitialSettings(),
    getTranslations("settings"),
  ]);

  return (
    <main style={{ paddingBottom: "var(--lb-sp-12)" }}>
      <header
        style={{
          height: "var(--lb-header-h)",
          padding: "0 var(--lb-sp-4)",
          display: "flex",
          alignItems: "center",
          borderBottom: "1px solid var(--lb-border)",
        }}
      >
        <h1
          style={{
            fontSize: "var(--lb-fs-xl)",
            fontWeight: "var(--lb-fw-semibold)",
            letterSpacing: "var(--lb-tracking-title)",
          }}
        >
          {t("title")}
        </h1>
      </header>
      <SettingsForm initial={initial} />
    </main>
  );
}

async function fetchInitialSettings(): Promise<SettingsInitial> {
  try {
    const reqHeaders = await headers();
    const host = reqHeaders.get("host");
    const proto = reqHeaders.get("x-forwarded-proto") ?? "http";
    if (!host) throw new Error("missing host header");
    const url = `${proto}://${host}/api/settings`;
    const res = await fetch(url, {
      cache: "no-store",
      headers: {
        cookie: reqHeaders.get("cookie") ?? "",
      },
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const json = (await res.json()) as
      | { ok: true; data: SettingsInitial }
      | { ok: false; error: { code: string; message: string } };
    if (!("ok" in json) || !json.ok) {
      throw new Error("settings api returned error envelope");
    }
    return json.data;
  } catch {
    // Backend may not have finished /api/settings yet; render with safe
    // defaults so the page still loads. The form will round-trip through
    // the live endpoint on save.
    return {
      timezone: "Europe/Istanbul",
      locale: "tr",
      notificationsEnabled: true,
      dateFormat: "DD.MM.YYYY",
      timeFormat: "24h",
    };
  }
}
