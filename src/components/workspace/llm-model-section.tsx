"use client";

import { useEffect, useState, type FormEvent } from "react";

type Props = {
  workspaceId: string;
  /** Owner-only — non-owners shouldn't see this surface at all. */
  canManage: boolean;
};

const MODEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash (default, ucuz)" },
  { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { value: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5 (hızlı)" },
  { value: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4" },
  { value: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5" },
  { value: "anthropic/claude-opus-4.7", label: "Claude Opus 4.7 (en güçlü)" },
  { value: "openai/gpt-4o-mini", label: "GPT-4o mini" },
  { value: "openai/gpt-4o", label: "GPT-4o" },
  { value: "openai/o1-mini", label: "o1-mini (akıl yürütme)" },
  { value: "x-ai/grok-3", label: "Grok 3" },
  { value: "deepseek/deepseek-chat", label: "DeepSeek V3" },
  { value: "deepseek/deepseek-r1", label: "DeepSeek R1 (akıl yürütme)" },
  { value: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
];

/**
 * Workspace-level LLM model picker (owner-only). The model governs
 * every member's bot turns in this workspace — spending + capability
 * decision lives with the owner per the post-billing-tear-out plan.
 */
export function LlmModelSection({ workspaceId, canManage }: Props) {
  const [current, setCurrent] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>("google/gemini-2.5-flash");
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/llm-model`);
        const json = (await res.json().catch(() => null)) as
          | { ok: true; data: { llmModel: string } }
          | { ok: false }
          | null;
        if (!cancelled && json && json.ok) {
          setCurrent(json.data.llmModel);
          setSelected(json.data.llmModel);
        }
      } catch {
        // Silent.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  if (!canManage) return null;

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (busy || selected === current) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/llm-model`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ llmModel: selected }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; data: { llmModel: string } }
        | { ok: false; error: { code: string; message: string } }
        | null;
      if (!res.ok || !json || !json.ok) {
        setError(json && !json.ok ? json.error.message : `HTTP ${res.status}`);
        return;
      }
      setCurrent(json.data.llmModel);
      setInfo("Kaydedildi.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div
        style={{
          fontSize: "var(--lb-fs-xs)",
          color: "var(--lb-muted-fg)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: "var(--lb-sp-2)",
        }}
      >
        LLM Model
      </div>
      <form
        onSubmit={onSave}
        style={{
          background: "var(--lb-card)",
          border: "1px solid var(--lb-border)",
          borderRadius: "var(--lb-radius-md)",
          padding: "var(--lb-sp-3) var(--lb-sp-4)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--lb-sp-2)",
        }}
      >
        <p
          style={{
            fontSize: "var(--lb-fs-xs)",
            color: "var(--lb-muted-fg)",
            margin: 0,
          }}
        >
          Bu workspace&apos;in tüm üyeleri bot ile konuşurken bu modeli
          kullanır. Maliyet OpenRouter API key&apos;ine yansır.
        </p>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          style={{
            background: "var(--lb-bg)",
            color: "var(--lb-fg)",
            border: "1px solid var(--lb-border)",
            borderRadius: "var(--lb-radius-md)",
            padding: "var(--lb-sp-2) var(--lb-sp-3)",
            fontSize: "var(--lb-fs-sm)",
          }}
        >
          {MODEL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <div
          style={{
            display: "flex",
            gap: "var(--lb-sp-3)",
            alignItems: "center",
          }}
        >
          <button
            type="submit"
            disabled={busy || selected === current}
            style={{
              background: "var(--lb-accent)",
              color: "var(--lb-accent-fg)",
              border: "none",
              padding: "var(--lb-sp-2) var(--lb-sp-4)",
              borderRadius: "var(--lb-radius-md)",
              fontWeight: "var(--lb-fw-medium)",
              fontSize: "var(--lb-fs-sm)",
              cursor:
                busy || selected === current ? "not-allowed" : "pointer",
              opacity: busy || selected === current ? 0.6 : 1,
            }}
          >
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </button>
          {error && (
            <span
              style={{
                color: "var(--lb-destructive, #D72D40)",
                fontSize: "var(--lb-fs-xs)",
              }}
              role="alert"
            >
              {error}
            </span>
          )}
          {info && (
            <span
              style={{
                color: "var(--lb-success, #2EB872)",
                fontSize: "var(--lb-fs-xs)",
              }}
            >
              {info}
            </span>
          )}
        </div>
      </form>
    </section>
  );
}
