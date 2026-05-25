/**
 * Mini App settings API validators.
 */
import { z } from "zod";

/**
 * The preset list of LLM models the user can choose from. Mirrors the
 * default model in `users.llm_model` and the `architecture.md` AI section.
 *
 * Single source of truth — `src/lib/ai/tools.ts` imports this list for
 * the `update_settings` tool's `llm_model` enum, so the bot picker, the
 * Mini App API validator, and the LLM tool schema can never drift.
 *
 * All entries below are OpenRouter slugs with reliable tool calling
 * (the 24-tool router needs solid function-call support).
 */
export const ALLOWED_LLM_MODELS = [
  // Anthropic — best-in-class tool calling for the 24-tool router.
  "anthropic/claude-haiku-4.5",
  "anthropic/claude-haiku-4",
  "anthropic/claude-sonnet-4",
  "anthropic/claude-sonnet-4.5",
  "anthropic/claude-opus-4",
  "anthropic/claude-opus-4.7",
  // OpenAI
  "openai/gpt-4o-mini",
  "openai/gpt-4o",
  "openai/gpt-5-mini",
  "openai/gpt-5",
  "openai/o1-mini",
  "openai/o3-mini",
  // Google Gemini
  "google/gemini-2.0-flash",
  "google/gemini-2.5-flash",
  "google/gemini-2.5-pro",
  // xAI
  "x-ai/grok-3-mini",
  "x-ai/grok-3",
  "x-ai/grok-4",
  // DeepSeek — V3 chat (function calling) + R1 reasoner (slower,
  // step-by-step thinking; tool calling supported).
  "deepseek/deepseek-chat",
  "deepseek/deepseek-r1",
  // Mistral
  "mistralai/mistral-small",
  "mistralai/mistral-large",
  // Meta — open-weights, OpenRouter pass-through.
  "meta-llama/llama-3.3-70b-instruct",
  "meta-llama/llama-4-maverick",
  // Qwen — open-weights, strong tool-call support.
  "qwen/qwen-2.5-72b-instruct",
] as const;

export type AllowedLlmModel = (typeof ALLOWED_LLM_MODELS)[number];

/**
 * Display metadata for each allowed model. `label` is the short name
 * shown on inline-keyboard buttons (Telegram caps button text at ~64
 * chars but anything over ~22 wraps awkwardly on mobile). `provider`
 * groups buttons in the picker view.
 *
 * Keys are exhaustively typed via `Record<AllowedLlmModel, …>`, so
 * adding a model to `ALLOWED_LLM_MODELS` without a meta entry is a
 * compile error — drift-proof.
 */
export const LLM_MODEL_META: Record<
  AllowedLlmModel,
  { label: string; provider: string }
> = {
  "anthropic/claude-haiku-4.5": { label: "Haiku 4.5", provider: "Anthropic" },
  "anthropic/claude-haiku-4": { label: "Haiku 4", provider: "Anthropic" },
  "anthropic/claude-sonnet-4": { label: "Sonnet 4", provider: "Anthropic" },
  "anthropic/claude-sonnet-4.5": { label: "Sonnet 4.5", provider: "Anthropic" },
  "anthropic/claude-opus-4": { label: "Opus 4", provider: "Anthropic" },
  "anthropic/claude-opus-4.7": { label: "Opus 4.7", provider: "Anthropic" },
  "openai/gpt-4o-mini": { label: "GPT-4o mini", provider: "OpenAI" },
  "openai/gpt-4o": { label: "GPT-4o", provider: "OpenAI" },
  "openai/gpt-5-mini": { label: "GPT-5 mini", provider: "OpenAI" },
  "openai/gpt-5": { label: "GPT-5", provider: "OpenAI" },
  "openai/o1-mini": { label: "o1-mini", provider: "OpenAI" },
  "openai/o3-mini": { label: "o3-mini", provider: "OpenAI" },
  "google/gemini-2.0-flash": { label: "Gemini 2.0 Flash", provider: "Google" },
  "google/gemini-2.5-flash": { label: "Gemini 2.5 Flash", provider: "Google" },
  "google/gemini-2.5-pro": { label: "Gemini 2.5 Pro", provider: "Google" },
  "x-ai/grok-3-mini": { label: "Grok 3 mini", provider: "xAI" },
  "x-ai/grok-3": { label: "Grok 3", provider: "xAI" },
  "x-ai/grok-4": { label: "Grok 4", provider: "xAI" },
  "deepseek/deepseek-chat": { label: "DeepSeek V3", provider: "DeepSeek" },
  "deepseek/deepseek-r1": { label: "DeepSeek R1", provider: "DeepSeek" },
  "mistralai/mistral-small": { label: "Mistral Small", provider: "Mistral" },
  "mistralai/mistral-large": { label: "Mistral Large", provider: "Mistral" },
  "meta-llama/llama-3.3-70b-instruct": {
    label: "Llama 3.3 70B",
    provider: "Meta",
  },
  "meta-llama/llama-4-maverick": {
    label: "Llama 4 Maverick",
    provider: "Meta",
  },
  "qwen/qwen-2.5-72b-instruct": { label: "Qwen 2.5 72B", provider: "Qwen" },
};

/**
 * Phase 14c: per-user date / time display preferences.
 * App-layer enums; no DB CHECK constraint.
 */
export const ALLOWED_DATE_FORMATS = [
  "DD.MM.YYYY",
  "MM/DD/YYYY",
  "YYYY-MM-DD",
] as const;

export type AllowedDateFormat = (typeof ALLOWED_DATE_FORMATS)[number];

export const ALLOWED_TIME_FORMATS = ["24h", "12h"] as const;

export type AllowedTimeFormat = (typeof ALLOWED_TIME_FORMATS)[number];

/**
 * Lax IANA timezone shape — `Region/City` or single-segment names like
 * `UTC`. The exact list is huge and version-skewed; reject obviously
 * invalid forms here and trust `Intl.DateTimeFormat` at runtime.
 */
const timezoneSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_+\-/]+$/, {
    message: "timezone must be an IANA name like Europe/Istanbul",
  });

const localeSchema = z.enum(["tr", "en"]);

/**
 * OpenRouter API keys observed in the wild start with `sk-or-`. We
 * accept any non-empty string that starts with that prefix; the actual
 * verification happens on first LLM call (lazy validation per
 * architecture.md).
 *
 * Empty string here means "clear my key" — the route handler nulls the
 * column when the body field is `''`.
 */
/**
 * Body of `PATCH /api/settings`. All fields optional; only provided
 * fields are mutated. Per-user BYOK was removed — the OpenRouter
 * API key is workspace-scoped, set via the workspace settings
 * org-key endpoint instead.
 */
export const patchSettingsBodySchema = z.object({
  locale: localeSchema.optional(),
  timezone: timezoneSchema.optional(),
  notificationsEnabled: z.boolean().optional(),
  /** Phase 14c: display preferences. */
  dateFormat: z.enum(ALLOWED_DATE_FORMATS).optional(),
  timeFormat: z.enum(ALLOWED_TIME_FORMATS).optional(),
});

export type PatchSettingsBody = z.infer<typeof patchSettingsBodySchema>;

/** Shape of `GET /api/settings` and `PATCH /api/settings` envelopes. */
export type GetSettingsResponse = {
  locale: "tr" | "en";
  timezone: string;
  notificationsEnabled: boolean;
  dateFormat: AllowedDateFormat;
  timeFormat: AllowedTimeFormat;
};
