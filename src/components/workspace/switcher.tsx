"use client";

import { ChevronDown, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { WorkspaceListItem } from "@/lib/types";

type Props = {
  workspaces: WorkspaceListItem[];
};

/**
 * Workspace switcher in the Mini App header. Tapping the active
 * workspace name opens a dropdown listing every workspace the user
 * belongs to with role + tier. Tapping a row calls
 * POST /api/workspaces/[id]/activate, then reloads the page so the
 * server-rendered list view reflects the new active workspace.
 *
 * Phase 4.5: Free tier blocks creation of a 2nd workspace with an
 * inline upgrade hint (tier middleware logs the attempt). Phase 5
 * UX: an enabled "Create workspace" CTA on Team/Workspace tier.
 */
export function WorkspaceSwitcher({ workspaces }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const active = workspaces.find((w) => w.isActive) ?? workspaces[0];

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (!active) return null;

  async function activate(workspaceId: string) {
    if (workspaceId === active?.id) {
      setOpen(false);
      return;
    }
    setBusy(workspaceId);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/activate`, {
        method: "POST",
      });
      if (res.ok) {
        // Reload so the server-rendered lists view picks up the new
        // active workspace context. Cheaper than a global re-fetch +
        // matches the Mini App's "always server-fresh" pattern.
        window.location.reload();
      } else {
        setBusy(null);
      }
    } catch {
      setBusy(null);
    }
  }

  const personalCount = workspaces.filter((w) => w.isPersonal).length;
  const totalOwned = workspaces.filter((w) => w.role === "owner").length;
  const canCreateMore = totalOwned > personalCount; // Phase 5 enforces tier
  // Phase 4.5: surface the gate visually. Tier from the active workspace
  // approximates "current user's tier" since billing is per-workspace.
  const upgradeHint = active.tier === "free" && totalOwned >= 1;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--lb-sp-2)",
          padding: "var(--lb-sp-2) var(--lb-sp-3)",
          background: "transparent",
          border: "1px solid transparent",
          borderRadius: "var(--lb-radius-md)",
          color: "var(--lb-fg)",
          fontSize: "var(--lb-fs-sm)",
          fontWeight: "var(--lb-fw-medium)",
          cursor: "pointer",
          maxWidth: "60vw",
          minWidth: 0,
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          {active.name}
        </span>
        <ChevronDown
          aria-hidden
          width={14}
          height={14}
          style={{ flexShrink: 0, color: "var(--lb-muted-fg)" }}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Switch workspace"
          style={{
            position: "absolute",
            top: "calc(100% + var(--lb-sp-1))",
            left: 0,
            zIndex: 50,
            minWidth: "260px",
            maxWidth: "calc(100vw - var(--lb-sp-6))",
            background: "var(--lb-card)",
            border: "1px solid var(--lb-border)",
            borderRadius: "var(--lb-radius-md)",
            boxShadow:
              "0 4px 12px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.05)",
            padding: "var(--lb-sp-1) 0",
          }}
        >
          {workspaces.map((w) => (
            <button
              key={w.id}
              type="button"
              role="option"
              aria-selected={w.isActive}
              disabled={busy !== null}
              onClick={() => activate(w.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--lb-sp-3)",
                width: "100%",
                padding: "var(--lb-sp-2) var(--lb-sp-3)",
                background: w.isActive ? "var(--lb-muted)" : "transparent",
                border: "none",
                borderLeft: w.isActive
                  ? "3px solid var(--lb-accent)"
                  : "3px solid transparent",
                color: "var(--lb-fg)",
                fontSize: "var(--lb-fs-sm)",
                textAlign: "left",
                cursor: busy ? "wait" : "pointer",
                opacity: busy && busy !== w.id ? 0.5 : 1,
              }}
            >
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {w.name}
                {w.isPersonal && (
                  <span
                    style={{
                      marginLeft: "var(--lb-sp-2)",
                      color: "var(--lb-muted-fg)",
                      fontSize: "var(--lb-fs-xs)",
                    }}
                  >
                    Personal
                  </span>
                )}
              </span>
              <TierBadge tier={w.tier} />
              <RolePill role={w.role} />
            </button>
          ))}

          <div
            style={{
              borderTop: "1px solid var(--lb-border)",
              marginTop: "var(--lb-sp-1)",
              paddingTop: "var(--lb-sp-1)",
            }}
          >
            <button
              type="button"
              disabled={!canCreateMore && upgradeHint}
              onClick={() => {
                window.location.href = "/workspace/new";
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--lb-sp-2)",
                width: "100%",
                padding: "var(--lb-sp-2) var(--lb-sp-3)",
                background: "transparent",
                border: "none",
                color: upgradeHint ? "var(--lb-muted-fg)" : "var(--lb-fg)",
                fontSize: "var(--lb-fs-sm)",
                textAlign: "left",
                cursor: upgradeHint ? "default" : "pointer",
              }}
            >
              <Plus aria-hidden width={14} height={14} />
              {upgradeHint ? "Upgrade to add workspace" : "Create workspace"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TierBadge({ tier }: { tier: string }) {
  const palette: Record<string, { bg: string; fg: string }> = {
    free: { bg: "var(--lb-muted)", fg: "var(--lb-muted-fg)" },
    team: { bg: "var(--lb-accent)", fg: "var(--lb-accent-fg)" },
    workspace: { bg: "var(--lb-fg)", fg: "var(--lb-bg)" },
  };
  const { bg, fg } = palette[tier] ?? palette.free!;
  return (
    <span
      style={{
        background: bg,
        color: fg,
        padding: "2px 6px",
        borderRadius: "999px",
        fontSize: "10px",
        fontWeight: "var(--lb-fw-medium)",
        textTransform: "capitalize",
      }}
    >
      {tier}
    </span>
  );
}

function RolePill({ role }: { role: string }) {
  return (
    <span
      style={{
        color: "var(--lb-muted-fg)",
        fontSize: "var(--lb-fs-xs)",
        textTransform: "capitalize",
      }}
    >
      {role}
    </span>
  );
}
