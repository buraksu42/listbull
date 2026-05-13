"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";

type Visibility = "public" | "private";

type Props = {
  listId: string;
  listName: string;
  initialVisibility: Visibility;
  canManage: boolean;
};

/**
 * Header-mounted button that flips list visibility between public and
 * private. Tap → confirm sheet → PATCH /api/lists/[id]/visibility →
 * router.refresh() so the SSR badge in the lists overview re-renders
 * on next navigation. Non-owners see a static badge (no click).
 */
export function VisibilityToggle({
  listId,
  listName,
  initialVisibility,
  canManage,
}: Props) {
  const router = useRouter();
  const [vis, setVis] = useState<Visibility>(initialVisibility);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPublic = vis === "public";
  const targetVisibility: Visibility = isPublic ? "private" : "public";
  const targetLabel = isPublic ? "private" : "public";
  const icon = isPublic ? "🌐" : "🔒";

  // Non-owner: static, informational badge (no click).
  if (!canManage) {
    return (
      <span
        aria-label={`${listName} — ${vis}`}
        title={
          isPublic
            ? "Public — workspace üyeleri görür"
            : "Private — sadece list üyeleri görür"
        }
        style={badgeStyle(isPublic)}
      >
        {icon}
      </span>
    );
  }

  async function persist(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/lists/${listId}/visibility`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visibility: targetVisibility }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; data: { visibility: Visibility } }
        | { ok: false; error: { code: string; message: string } }
        | null;
      if (!res.ok || !json || !json.ok) {
        setError(json && "error" in json ? json.error.message : "Save failed");
        return;
      }
      setVis(json.data.visibility);
      setConfirmOpen(false);
      // Refresh SSR badges in lists overview if user navigates back.
      router.refresh();
    } catch {
      setError("Bağlantı sorunu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label={`Toggle visibility for ${listName} (currently ${vis})`}
        title={
          isPublic
            ? "Public — tıklayarak private yap"
            : "Private — tıklayarak public yap"
        }
        onClick={() => setConfirmOpen(true)}
        className={cn(
          "inline-flex h-11 w-11 items-center justify-center rounded-[var(--lb-r-md)]",
          "hover:bg-[var(--lb-muted)] focus-visible:bg-[var(--lb-muted)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lb-accent)]",
        )}
        style={{ fontSize: "var(--lb-fs-lg)" }}
      >
        {icon}
      </button>

      {confirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="vis-confirm-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirmOpen(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            zIndex: 50,
          }}
        >
          <div
            style={{
              background: "var(--lb-bg)",
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              padding: "var(--lb-sp-5) var(--lb-sp-4)",
              width: "100%",
              maxWidth: 480,
              display: "flex",
              flexDirection: "column",
              gap: "var(--lb-sp-4)",
            }}
          >
            <header
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--lb-sp-2)",
              }}
            >
              <h2
                id="vis-confirm-title"
                style={{
                  fontSize: "var(--lb-fs-lg)",
                  fontWeight: "var(--lb-fw-semibold)",
                }}
              >
                {targetLabel === "public"
                  ? `"${listName}" public yapılsın mı?`
                  : `"${listName}" private yapılsın mı?`}
              </h2>
              <p
                style={{
                  fontSize: "var(--lb-fs-sm)",
                  color: "var(--lb-muted-fg)",
                  lineHeight: 1.5,
                }}
              >
                {targetLabel === "public"
                  ? "Bu workspace'in tüm üyeleri listeyi görür. Owner / admin / editor düzenleyebilir; viewer / guest sadece okur."
                  : "Sadece list_members olarak eklenmiş kişiler listeyi görür. Workspace üyeleri görmez."}
              </p>
            </header>

            {error && (
              <p
                style={{
                  fontSize: "var(--lb-fs-sm)",
                  color: "var(--lb-danger)",
                }}
              >
                {error}
              </p>
            )}

            <div
              style={{
                display: "flex",
                gap: "var(--lb-sp-2)",
              }}
            >
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                style={{
                  flex: 1,
                  padding: "var(--lb-sp-3)",
                  border: "1px solid var(--lb-border)",
                  borderRadius: "var(--lb-radius-md)",
                  background: "transparent",
                  color: "var(--lb-fg)",
                  fontSize: "var(--lb-fs-base)",
                  fontWeight: "var(--lb-fw-medium)",
                }}
              >
                İptal
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={persist}
                style={{
                  flex: 1,
                  padding: "var(--lb-sp-3)",
                  border: "none",
                  borderRadius: "var(--lb-radius-md)",
                  background: "var(--lb-accent)",
                  color: "var(--lb-accent-fg)",
                  fontSize: "var(--lb-fs-base)",
                  fontWeight: "var(--lb-fw-semibold)",
                  opacity: busy ? 0.6 : 1,
                }}
              >
                {busy
                  ? "Kaydediliyor…"
                  : targetLabel === "public"
                    ? "Public yap"
                    : "Private yap"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function badgeStyle(isPublic: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    height: 32,
    minWidth: 32,
    padding: "0 8px",
    fontSize: "var(--lb-fs-sm)",
    color: "var(--lb-muted-fg)",
    background: isPublic
      ? "color-mix(in srgb, var(--lb-accent) 12%, transparent)"
      : "transparent",
    border: isPublic
      ? "1px solid color-mix(in srgb, var(--lb-accent) 35%, transparent)"
      : "1px solid var(--lb-border)",
    borderRadius: 6,
  };
}
