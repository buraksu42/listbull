/**
 * Mini App settings API validators.
 */
import { z } from "zod";

/**
 * The preset list of LLM models the user can choose from. Mirrors the
 * default model in `users.llm_model` and the `architecture.md` AI section.
 */
export const ALLOWED_LLM_MODELS = [
  "anthropic/claude-haiku-4.5",
  "openai/gpt-4o-mini",
  "anthropic/claude-sonnet-4",
  "anthropic/claude-opus-4.7",
] as const;

export type AllowedLlmModel = (typeof ALLOWED_LLM_MODELS)[number];

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
const openrouterKeySchema = z.union([
  z.literal(""),
  z
    .string()
    .min(8)
    .max(256)
    .startsWith("sk-or-", {
      message: "OpenRouter API key must start with 'sk-or-'",
    }),
]);

/**
 * Body of `PATCH /api/settings`. All fields optional; only provided
 * fields are mutated.
 */
export const patchSettingsBodySchema = z.object({
  locale: localeSchema.optional(),
  timezone: timezoneSchema.optional(),
  llmModel: z.enum(ALLOWED_LLM_MODELS).optional(),
  notificationsEnabled: z.boolean().optional(),
  /** When provided AND non-empty: encrypt + store. When `''`: clear. */
  openrouterApiKey: openrouterKeySchema.optional(),
});

export type PatchSettingsBody = z.infer<typeof patchSettingsBodySchema>;

/**
 * Shape of `GET /api/settings` and `PATCH /api/settings`. BYOK key NEVER
 * leaves the server in plaintext — only `byokKeyPreview` (last 4 chars)
 * is exposed.
 *
 * `hasApiKey` is the boolean Frontend uses to decide whether to render
 * the "stored key" UI affordance vs. the empty input. It tracks
 * `users.openrouter_api_key_encrypted IS NOT NULL` (independent of
 * whether the ciphertext is currently decryptable — see settings/route.ts
 * GET, which surfaces `byokKeyPreview: null` when decryption fails).
 */
export type GetSettingsResponse = {
  locale: "tr" | "en";
  timezone: string;
  llmModel: string;
  notificationsEnabled: boolean;
  hasApiKey: boolean;
  byokKeyPreview: string | null;
};
