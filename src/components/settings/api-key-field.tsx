"use client";

import { Eye, EyeOff } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * BYOK key entry. The plaintext key is never read back from the server —
 * we only ever receive `keyPreview` (last 4 chars). Two states:
 *
 * 1. Configured (preview present, no editing in flight): show a masked
 *    placeholder ("sk-…AB12") + a "Replace key" button.
 * 2. Editing / unconfigured: render the input field with a show/hide
 *    eye toggle.
 */
export function ApiKeyField({
  id,
  label,
  value,
  onChange,
  hasStoredKey,
  storedKeyPreview,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  hasStoredKey: boolean;
  storedKeyPreview: string | null;
  className?: string;
}) {
  const [revealed, setRevealed] = React.useState(false);
  // When a stored key exists, default to the "configured" view so the
  // user doesn't accidentally overwrite. They click "Replace key" to start
  // editing — that flips `editing=true`, exposing the input.
  const [editingRequested, setEditingRequested] = React.useState(false);
  // Derived: show the editor when explicitly requested, when there's no
  // stored key, or when the user has typed into the field. This keeps
  // collapse-after-save automatic without a setState-in-effect anti-pattern.
  const editing = editingRequested || !hasStoredKey || value !== "";

  if (!editing && hasStoredKey) {
    const masked = storedKeyPreview
      ? `sk-…${storedKeyPreview}`
      : "•••• •••• •••• ••••";
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        <Label htmlFor={id}>{label}</Label>
        <div className="flex items-center gap-2">
          <span
            id={id}
            className="flex-1 rounded-[var(--lb-r-md)] border border-[var(--lb-border)] bg-[var(--lb-input-bg)] px-3 py-2 font-mono text-sm text-[var(--lb-muted-fg)]"
            aria-label={`Current key ending in ${storedKeyPreview ?? "unknown"}`}
          >
            {masked}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => {
              setEditingRequested(true);
              setRevealed(false);
            }}
          >
            Replace key
          </Button>
        </div>
        <p className="text-xs text-[var(--lb-muted-fg)]">
          Stored encrypted on the server. Replace to rotate.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-stretch gap-2">
        <Input
          id={id}
          type={revealed ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="sk-or-v1-…"
          autoComplete="off"
          spellCheck={false}
          inputMode="text"
          className="flex-1 font-mono text-sm"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={revealed ? "Hide key" : "Show key"}
          onClick={() => setRevealed((r) => !r)}
        >
          {revealed ? (
            <EyeOff className="h-4 w-4" aria-hidden />
          ) : (
            <Eye className="h-4 w-4" aria-hidden />
          )}
        </Button>
      </div>
      {hasStoredKey && (
        <button
          type="button"
          onClick={() => {
            setEditingRequested(false);
            onChange("");
          }}
          className="self-start text-xs text-[var(--lb-muted-fg)] underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lb-accent)]"
        >
          Cancel — keep existing key
        </button>
      )}
      <p className="text-xs text-[var(--lb-muted-fg)]">
        We use this key to call OpenRouter on your behalf. Get one at{" "}
        <a
          href="https://openrouter.ai/keys"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          openrouter.ai/keys
        </a>
        .
      </p>
    </div>
  );
}
