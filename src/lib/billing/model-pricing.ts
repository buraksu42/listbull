/**
 * Model pricing table — USD per 1M tokens, split prompt vs completion.
 *
 * Numbers here track public OpenRouter/Anthropic list prices as of
 * the file's edit date. Operator can override at deploy time via
 * future MODEL_PRICING_OVERRIDE env (Phase 8.5+ if needed).
 *
 * For models not in the table, cost is recorded as 0 — operator can
 * compute later from token totals + their own pricing data.
 *
 * USD-per-1M format chosen because:
 *  - it matches OpenRouter's published rate-card layout
 *  - integer micro-USD storage in llm_usage avoids float drift
 *
 * Storage: cost_usd_micro = round(tokens × pricePer1M / 1_000_000 × 1_000_000)
 *                         = round(tokens × pricePer1M)
 * (the inner ÷1M cancels with the ×1M for storage in micro-USD).
 */
export type ModelPrice = {
  /** USD per 1M prompt (input) tokens. */
  promptPer1M: number;
  /** USD per 1M completion (output) tokens. */
  completionPer1M: number;
};

/**
 * Frozen rate card. Keys match OpenRouter model ids (which match
 * `users.llmModel` values from update_settings + the env list).
 *
 * Numbers verified 2026-05-06; bump on Anthropic/Google/OpenAI
 * pricing updates. Sources:
 *  - Anthropic: https://www.anthropic.com/pricing
 *  - OpenRouter pass-through (no markup currently)
 */
export const MODEL_PRICING: Readonly<Record<string, ModelPrice>> =
  Object.freeze({
    // Anthropic — Claude 4.x family
    "anthropic/claude-haiku-4.5": { promptPer1M: 1.0, completionPer1M: 5.0 },
    "anthropic/claude-sonnet-4": { promptPer1M: 3.0, completionPer1M: 15.0 },
    "anthropic/claude-sonnet-4.5": { promptPer1M: 3.0, completionPer1M: 15.0 },
    "anthropic/claude-opus-4.7": { promptPer1M: 15.0, completionPer1M: 75.0 },

    // Google — Gemini 2.5
    "google/gemini-2.5-flash": { promptPer1M: 0.3, completionPer1M: 2.5 },
    "google/gemini-2.5-pro": { promptPer1M: 1.25, completionPer1M: 10.0 },

    // OpenAI — GPT-4o family (kept for users on legacy llmModel values)
    "openai/gpt-4o-mini": { promptPer1M: 0.15, completionPer1M: 0.6 },
    "openai/gpt-4o": { promptPer1M: 2.5, completionPer1M: 10.0 },
    "openai/o1-mini": { promptPer1M: 1.1, completionPer1M: 4.4 },

    // xAI
    "x-ai/grok-3": { promptPer1M: 3.0, completionPer1M: 15.0 },

    // DeepSeek — V3 chat (off-peak pricing not modeled; we use the
    // higher tier so spend caps don't surprise users).
    "deepseek/deepseek-chat": { promptPer1M: 0.27, completionPer1M: 1.10 },

    // Meta open-weights — OpenRouter pass-through, single rate.
    "meta-llama/llama-3.3-70b-instruct": {
      promptPer1M: 0.59,
      completionPer1M: 0.79,
    },
  });

/**
 * Compute cost in micro-USD (cents × 10000) from tokens + model.
 * Returns 0 when model isn't in the rate card — caller may surface
 * a "pricing unknown" hint, but we don't refuse to record usage.
 */
export function calculateCostUsdMicro(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const price = MODEL_PRICING[model];
  if (!price) return 0;
  // tokens × USD/1M tokens = USD; ×1_000_000 to get micro-USD.
  // Equivalent: tokens × pricePer1M (the per-1M divisor cancels).
  const promptMicro = Math.round(promptTokens * price.promptPer1M);
  const completionMicro = Math.round(
    completionTokens * price.completionPer1M,
  );
  return promptMicro + completionMicro;
}
