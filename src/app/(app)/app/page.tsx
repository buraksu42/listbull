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
        const res = await fetch("/api/auth/telegram", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ initData: tg.initData }),
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
          // Cookie is set. If the Mini App was launched via a
          // `t.me/<bot>?startapp=invite_<token>` deeplink, route to
          // the invite-accept screen; otherwise fall through to the
          // list-of-lists view. Future start_param prefixes can be
          // added here (e.g. `item_<id>` for item-deeplinks).
          const startParam = tg.initDataUnsafe?.start_param ?? "";
          if (startParam.startsWith("invite_")) {
            const token = startParam.slice("invite_".length);
            window.location.replace(`/invites/${encodeURIComponent(token)}`);
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
