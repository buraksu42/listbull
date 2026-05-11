"use client";

import { useEffect, useState } from "react";

import "@/lib/telegram/webapp-types";

type Phase = "booting" | "no-telegram" | "auth-failed";

export default function AppBoot() {
  const [phase, setPhase] = useState<Phase>("booting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const tg = window.Telegram?.WebApp;

      if (!tg || !tg.initData) {
        if (!cancelled) setPhase("no-telegram");
        return;
      }

      tg.ready?.();
      tg.expand?.();

      try {
        // Detect the browser's IANA timezone so the server can replace
        // the placeholder UTC default for users whose Telegram client
        // language doesn't hint at their region (most non-TR users).
        // Falls back to "UTC" if the browser is too old; the server
        // ignores any value matching the current stored timezone.
        let browserTz = "UTC";
        try {
          browserTz =
            Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        } catch {
          /* tolerant — IE/old engines */
        }

        const res = await fetch("/api/auth/telegram", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ initData: tg.initData, timezone: browserTz }),
        });

        if (!res.ok) {
          const json = (await res.json().catch(() => null)) as
            | { error?: { message?: string } }
            | null;
          if (!cancelled) {
            setError(json?.error?.message ?? `HTTP ${res.status}`);
            setPhase("auth-failed");
          }
          return;
        }

        if (!cancelled) {
          // Cookie is set. Routes by start_param prefix:
          //   invite_<token>    → per-list invite accept (Phase 3)
          //   wsinvite_<token>  → workspace invite accept (Phase 5.5)
          //   item_<uuid>       → resolve list via /api/items/<uuid>/locate
          //                       and jump into /lists/<listId> with the
          //                       item highlighted (inline-mode handoff)
          //   <empty> / other   → /lists (default)
          const startParam = tg.initDataUnsafe?.start_param ?? "";
          if (startParam.startsWith("invite_")) {
            const token = startParam.slice("invite_".length);
            window.location.replace(`/invites/${encodeURIComponent(token)}`);
          } else if (startParam.startsWith("wsinvite_")) {
            const token = startParam.slice("wsinvite_".length);
            window.location.replace(
              `/workspace-invites/${encodeURIComponent(token)}`,
            );
          } else if (startParam.startsWith("item_")) {
            const itemId = startParam.slice("item_".length);
            try {
              const res = await fetch(
                `/api/items/${encodeURIComponent(itemId)}/locate`,
                { credentials: "same-origin" },
              );
              if (res.ok) {
                const json = (await res.json()) as {
                  ok?: boolean;
                  data?: { listId?: string };
                };
                const listId = json?.data?.listId;
                if (listId) {
                  // Auto-switch active workspace before navigating
                  // (same rationale as the list_ branch below).
                  try {
                    await fetch(
                      `/api/workspaces/activate-by-list?listId=${encodeURIComponent(listId)}`,
                      { method: "POST", credentials: "same-origin" },
                    );
                  } catch {
                    // best-effort
                  }
                  window.location.replace(
                    `/lists/${encodeURIComponent(listId)}?item=${encodeURIComponent(itemId)}`,
                  );
                  return;
                }
              }
            } catch {
              // fall through to /lists
            }
            window.location.replace("/lists");
          } else if (startParam.startsWith("list_")) {
            const listId = startParam.slice("list_".length);
            // Auto-switch active workspace if this list lives in a
            // workspace the user is a member of but not currently
            // active in. If the list doesn't exist (deleted /
            // mis-typed deeplink), fall through to /lists rather
            // than navigating into a 404 page — Telegram's WebApp
            // shell renders 404s as a generic "Something went
            // wrong" duck which gives the user no recourse.
            let canNavigate = false;
            try {
              const res = await fetch(
                `/api/workspaces/activate-by-list?listId=${encodeURIComponent(listId)}`,
                { method: "POST", credentials: "same-origin" },
              );
              canNavigate = res.ok;
            } catch {
              // Network error — fall through.
            }
            if (canNavigate) {
              window.location.replace(
                `/lists/${encodeURIComponent(listId)}`,
              );
            } else {
              window.location.replace("/lists");
            }
          } else {
            window.location.replace("/lists");
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setPhase("auth-failed");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: "var(--lb-sp-6)",
        textAlign: "center",
      }}
    >
      {phase === "booting" && (
        <p style={{ color: "var(--lb-muted-fg)" }}>Loading…</p>
      )}
      {phase === "no-telegram" && (
        <div>
          <p style={{ color: "var(--lb-fg)", marginBottom: "var(--lb-sp-3)" }}>
            listbull works inside Telegram.
          </p>
          <p style={{ color: "var(--lb-muted-fg)" }}>
            Open this app via the bot button on Telegram.
          </p>
        </div>
      )}
      {phase === "auth-failed" && (
        <div>
          <p style={{ color: "var(--lb-destructive)" }}>
            Authentication failed.
          </p>
          {error && (
            <p
              style={{
                color: "var(--lb-muted-fg)",
                fontSize: "var(--lb-fs-sm)",
                marginTop: "var(--lb-sp-2)",
              }}
            >
              {error}
            </p>
          )}
        </div>
      )}
    </main>
  );
}
