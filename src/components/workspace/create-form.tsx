"use client";

import { useState, type FormEvent } from "react";

export function CreateWorkspaceForm() {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const json = (await res.json().catch(() => null)) as
        | {
            ok: true;
            data: { workspace: { id: string } };
          }
        | { ok: false; error: { code: string; message: string } }
        | null;
      if (!res.ok || !json || !json.ok) {
        const msg =
          json && !json.ok
            ? json.error.message
            : `HTTP ${res.status}`;
        setError(msg);
        setBusy(false);
        return;
      }
      // Activate the new workspace, then route to /lists.
      await fetch(`/api/workspaces/${json.data.workspace.id}/activate`, {
        method: "POST",
      });
      window.location.replace("/lists");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--lb-sp-3)",
      }}
    >
      <label
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--lb-sp-1)",
        }}
      >
        <span
          style={{
            fontSize: "var(--lb-fs-sm)",
            color: "var(--lb-muted-fg)",
          }}
        >
          Name
        </span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Work, Family, Side project..."
          maxLength={120}
          autoFocus
          required
          style={{
            background: "var(--lb-card)",
            color: "var(--lb-fg)",
            border: "1px solid var(--lb-border)",
            borderRadius: "var(--lb-radius-md)",
            padding: "var(--lb-sp-2) var(--lb-sp-3)",
            fontSize: "var(--lb-fs-base)",
          }}
        />
      </label>

      {error && (
        <p
          style={{
            color: "var(--lb-destructive, #D72D40)",
            fontSize: "var(--lb-fs-sm)",
          }}
          role="alert"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || !name.trim()}
        style={{
          alignSelf: "flex-start",
          background: "var(--lb-accent)",
          color: "var(--lb-accent-fg)",
          border: "none",
          padding: "var(--lb-sp-2) var(--lb-sp-5)",
          borderRadius: "var(--lb-radius-md)",
          fontWeight: "var(--lb-fw-medium)",
          fontSize: "var(--lb-fs-base)",
          cursor: busy || !name.trim() ? "not-allowed" : "pointer",
          opacity: busy || !name.trim() ? 0.6 : 1,
        }}
      >
        {busy ? "Creating…" : "Create workspace"}
      </button>
    </form>
  );
}
