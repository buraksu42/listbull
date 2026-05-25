/**
 * Sentry payload scrubber.
 *
 * Defense-in-depth: `sendDefaultPii: false` already disables PII
 * auto-collection. This goes one step further — if an exception
 * message or stack trace ACCIDENTALLY carries a token-shaped
 * substring (a decrypt buffer, an OpenRouter key in an error body,
 * a Telegram bot token in a URL), we redact it before it ships.
 *
 * Patterns are conservative — false-positive cost is "we replaced
 * a few random chars in an error message" which is fine; false
 * negatives leak secrets to Sentry, which is not.
 */
import type { ErrorEvent } from "@sentry/core";

const PATTERNS: ReadonlyArray<RegExp> = [
  // OpenAI / Anthropic / OpenRouter family.
  /\bsk-(?:ant-api03-|or-v1-|[A-Za-z0-9])[A-Za-z0-9_-]{20,}\b/g,
  // GitHub PAT / OAuth / Server-to-server / App.
  /\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{36,}\b/g,
  // Slack bot / user / app tokens.
  /\bxox[bpars]-\d+-\d+-\d+-[A-Za-z0-9]+\b/g,
  // AWS access key id.
  /\bAKIA[0-9A-Z]{16}\b/g,
  // Telegram bot token (NUMERIC_ID:35-char-alphanumeric). Loosened
  // bounds because newer bot ids are longer.
  /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g,
];

const REDACTED = "[redacted-secret]";

function scrubString(input: string): string {
  let out = input;
  for (const pat of PATTERNS) {
    out = out.replace(pat, REDACTED);
  }
  return out;
}

function scrubValue(v: unknown): unknown {
  if (typeof v === "string") return scrubString(v);
  if (Array.isArray(v)) return v.map(scrubValue);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = scrubValue(val);
    }
    return out;
  }
  return v;
}

/**
 * Walk the event and redact secret-shaped strings from exception
 * messages, stack frames, breadcrumbs, and extra fields. Returns
 * `null` would drop the event entirely — we don't do that here; we
 * just sanitize and forward.
 */
export function scrubSentryEvent(event: ErrorEvent): ErrorEvent {
  if (event.message) event.message = scrubString(event.message);

  if (event.exception?.values) {
    for (const ex of event.exception.values) {
      if (ex.value) ex.value = scrubString(ex.value);
      if (ex.stacktrace?.frames) {
        for (const f of ex.stacktrace.frames) {
          if (typeof f.filename === "string") f.filename = scrubString(f.filename);
          if (typeof f.module === "string") f.module = scrubString(f.module);
        }
      }
    }
  }

  if (event.breadcrumbs) {
    for (const b of event.breadcrumbs) {
      if (typeof b.message === "string") b.message = scrubString(b.message);
      if (b.data) b.data = scrubValue(b.data) as Record<string, unknown>;
    }
  }

  if (event.extra) {
    event.extra = scrubValue(event.extra) as Record<string, unknown>;
  }

  return event;
}
