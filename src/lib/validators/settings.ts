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
 * Curated set: each provider's flagship (no "mini" / older variants) +
 * open-weight workhorses (DeepSeek, Qwen, Llama) for cost-sensitive
 * users. All slugs have reliable tool calling — required by the
 * 24-tool router.
 */
export const ALLOWED_LLM_MODELS = [
  // Anthropic — flagships only.
  "anthropic/claude-haiku-4.5",
  "anthropic/claude-sonnet-4.5",
  "anthropic/claude-opus-4.7",
  // OpenAI
  "openai/gpt-4o",
  "openai/gpt-5",
  // Google Gemini
  "google/gemini-2.5-flash",
  "google/gemini-2.5-pro",
  // xAI — current flagship.
  "x-ai/grok-4",
  // DeepSeek — V3 chat (function calling) + R1 reasoner.
  "deepseek/deepseek-chat",
  "deepseek/deepseek-r1",
  // Qwen — chat + QwQ reasoner.
  "qwen/qwen-2.5-72b-instruct",
  "qwen/qwq-32b-preview",
  // Meta — top open-weight workhorse.
  "meta-llama/llama-3.3-70b-instruct",
] as const;

export type AllowedLlmModel = (typeof ALLOWED_LLM_MODELS)[number];

/**
 * Cost tier — coarse buckets so the picker can show price-at-a-glance
 * without going stale every time OpenRouter changes a per-token rate.
 * Bands are approximate input-token cost per 1M tokens on OpenRouter:
 *   $    ≤ $1
 *   $$   $1 – $5
 *   $$$  $5 – $15
 *   $$$$ > $15
 */
export type ModelTier = "$" | "$$" | "$$$" | "$$$$";

/**
 * Display metadata for each allowed model. `label` is the short name
 * shown on inline-keyboard buttons (Telegram caps button text at ~64
 * chars but anything over ~22 wraps awkwardly on mobile). `provider`
 * groups buttons in the picker view. `tier` is the cost band.
 *
 * Keys are exhaustively typed via `Record<AllowedLlmModel, …>`, so
 * adding a model to `ALLOWED_LLM_MODELS` without a meta entry is a
 * compile error — drift-proof.
 */
export const LLM_MODEL_META: Record<
  AllowedLlmModel,
  { label: string; provider: string; tier: ModelTier }
> = {
  "anthropic/claude-haiku-4.5": {
    label: "Haiku 4.5",
    provider: "Anthropic",
    tier: "$",
  },
  "anthropic/claude-sonnet-4.5": {
    label: "Sonnet 4.5",
    provider: "Anthropic",
    tier: "$$",
  },
  "anthropic/claude-opus-4.7": {
    label: "Opus 4.7",
    provider: "Anthropic",
    tier: "$$$$",
  },
  "openai/gpt-4o": { label: "GPT-4o", provider: "OpenAI", tier: "$$" },
  "openai/gpt-5": { label: "GPT-5", provider: "OpenAI", tier: "$$$" },
  "google/gemini-2.5-flash": {
    label: "Gemini 2.5 Flash",
    provider: "Google",
    tier: "$",
  },
  "google/gemini-2.5-pro": {
    label: "Gemini 2.5 Pro",
    provider: "Google",
    tier: "$$",
  },
  "x-ai/grok-4": { label: "Grok 4", provider: "xAI", tier: "$$$" },
  "deepseek/deepseek-chat": {
    label: "DeepSeek V3",
    provider: "DeepSeek",
    tier: "$",
  },
  "deepseek/deepseek-r1": {
    label: "DeepSeek R1",
    provider: "DeepSeek",
    tier: "$",
  },
  "qwen/qwen-2.5-72b-instruct": {
    label: "Qwen 2.5 72B",
    provider: "Qwen",
    tier: "$",
  },
  "qwen/qwq-32b-preview": {
    label: "Qwen QwQ 32B",
    provider: "Qwen",
    tier: "$",
  },
  "meta-llama/llama-3.3-70b-instruct": {
    label: "Llama 3.3 70B",
    provider: "Meta",
    tier: "$",
  },
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
