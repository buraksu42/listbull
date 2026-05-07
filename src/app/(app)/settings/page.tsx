import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

import { ExportButton } from "@/components/settings/export-button";
import {
  SettingsForm,
  type SettingsInitial,
} from "@/components/settings/settings-form";
import { getMemberCap, getUserLlmUsage } from "@/lib/db/queries/llm-usage";
import { resolveActiveWorkspaceId } from "@/lib/db/queries/workspaces";
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
  const user = await requireUser();
  const workspaceId = await resolveActiveWorkspaceId(user.id);
  const [initial, usage, cap, t] = await Promise.all([
    fetchInitialSettings(),
    getUserLlmUsage(user.id, 30),
    getMemberCap(workspaceId, user.id),
    getTranslations("settings"),
  ]);
  const totalTokens = usage.totalPromptTokens + usage.totalCompletionTokens;
  const hasCap =
    cap !== null &&
    (cap.dailyCapUsdMicro > 0 || cap.monthlyCapUsdMicro > 0);

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

      {totalTokens > 0 && (
        <section className="flex flex-col gap-2 px-4 pt-2">
          <h2 className="text-base font-semibold text-[var(--lb-fg)]">
            Last 30 days
          </h2>
          <div
            className="flex flex-col gap-1 rounded-[var(--lb-radius-md)] border border-[var(--lb-border)] bg-[var(--lb-card)] p-4"
            style={{ fontSize: "var(--lb-fs-sm)" }}
          >
            <p style={{ color: "var(--lb-muted-fg)" }}>
              {usage.callCount.toLocaleString()} LLM call
              {usage.callCount === 1 ? "" : "s"} ·{" "}
              {totalTokens.toLocaleString()} tokens
              {usage.totalCostUsdMicro > 0 && (
                <>
                  {" "}
                  · ${(usage.totalCostUsdMicro / 1_000_000).toFixed(4)}
                </>
              )}
            </p>
            <p
              style={{
                color: "var(--lb-muted-fg)",
                fontSize: "var(--lb-fs-xs)",
              }}
            >
              {usage.totalPromptTokens.toLocaleString()} prompt /{" "}
              {usage.totalCompletionTokens.toLocaleString()} completion
            </p>
          </div>
        </section>
      )}

      {hasCap && cap && (
        <section className="flex flex-col gap-2 px-4 pt-2">
          <h2 className="text-base font-semibold text-[var(--lb-fg)]">
            Workspace spend cap
          </h2>
          <div
            className="flex flex-col gap-1 rounded-[var(--lb-radius-md)] border border-[var(--lb-border)] bg-[var(--lb-card)] p-4"
            style={{ fontSize: "var(--lb-fs-sm)" }}
          >
            <p style={{ color: "var(--lb-muted-fg)" }}>
              Bu workspace&apos;te org-key kullanırken senin için
              ayarlanmış limit.
            </p>
            <p style={{ color: "var(--lb-fg)", marginTop: 4 }}>
              {cap.dailyCapUsdMicro > 0 && (
                <>
                  Günlük: $
                  {(cap.dailyCapUsdMicro / 1_000_000).toFixed(2)}
                </>
              )}
              {cap.dailyCapUsdMicro > 0 &&
                cap.monthlyCapUsdMicro > 0 &&
                " · "}
              {cap.monthlyCapUsdMicro > 0 && (
                <>
                  30 günlük: $
                  {(cap.monthlyCapUsdMicro / 1_000_000).toFixed(2)}
                </>
              )}
            </p>
            <p
              style={{
                color: "var(--lb-muted-fg)",
                fontSize: "var(--lb-fs-xs)",
                marginTop: 4,
              }}
            >
              Personal BYOK kullandığında limit uygulanmaz — kendi
              key&apos;in, kendi harcaman.
            </p>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3 px-4 pt-2">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold text-[var(--lb-fg)]">
            {t("exportTitle")}
          </h2>
          <p className="text-xs text-[var(--lb-muted-fg)]">
            {t("exportDescription")}
          </p>
        </div>
        <div>
          <ExportButton
            label={t("exportButton")}
            pendingLabel={t("exportPending")}
            successMessage={t("exportSuccess")}
            failureMessage={t("exportFailed")}
          />
        </div>
      </section>
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
      llmModel: "google/gemini-2.5-flash",
      timezone: "Europe/Istanbul",
      locale: "tr",
      notificationsEnabled: true,
      hasApiKey: false,
      byokKeyPreview: null,
    };
  }
}
