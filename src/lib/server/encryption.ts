/**
 * BYOK key encryption — AES-256-GCM via `node:crypto`.
 *
 * `users.openrouter_api_key_encrypted` stores the base64 envelope:
 *   `iv (12 bytes) || authTag (16 bytes) || ciphertext`
 *
 * The symmetric key comes from `env.ENV_KEY` (base64-decoded; we accept
 * raw 32-byte strings for dev convenience but base64 is canonical).
 *
 * Pure functions; small. Phase 4 will add a Vitest round-trip suite.
 */
import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCM,
  type DecipherGCM,
} from "node:crypto";

import { env } from "@/lib/env";

const ALGO = "aes-256-gcm";
const IV_LEN = 12; // GCM-recommended nonce length
const TAG_LEN = 16; // 128-bit auth tag (GCM default)
const KEY_LEN = 32; // AES-256

/**
 * Resolve `env.ENV_KEY` to a 32-byte buffer.
 *
 * Accepts ONLY proper key encodings — base64 (canonical) or hex.
 * The previous UTF-8 raw-chars fallback was a foot-gun: it silently
 * accepted any 32-character string like "xxxxxxxx..." as a "key",
 * producing an 8-bit-entropy key with no diagnostic. We'd rather
 * fail loud at boot than encrypt with a weak key.
 *
 * Generate a proper key:
 *   openssl rand -base64 32     (canonical, 44 chars with `=` padding)
 *   openssl rand -hex 32        (alternate, 64 hex chars)
 */
function loadKey(): Buffer {
  const raw = env.ENV_KEY;
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error(
      "ENV_KEY missing — generate with `openssl rand -base64 32`",
    );
  }

  // Base64 canonical (with or without `=` padding).
  const b64 = Buffer.from(raw, "base64");
  if (b64.length === KEY_LEN) return b64;

  // Hex tolerance (`openssl rand -hex 32` → 64 hex chars).
  if (raw.length === 64 && /^[0-9a-fA-F]+$/.test(raw)) {
    const hex = Buffer.from(raw, "hex");
    if (hex.length === KEY_LEN) return hex;
  }

  throw new Error(
    `ENV_KEY must decode to ${KEY_LEN} bytes (base64 or hex). ` +
      `Generate: \`openssl rand -base64 32\`. ` +
      `Refusing to use raw-chars fallback (foot-gun).`,
  );
}

let cachedKey: Buffer | null = null;
function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  cachedKey = loadKey();
  return cachedKey;
}

/**
 * Encrypt plaintext to base64(iv || authTag || ciphertext).
 *
 * AES-256-GCM. Uses a fresh 12-byte IV per call (random; collision risk
 * negligible at expected scale).
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv) as CipherGCM;
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const envelope = Buffer.concat([iv, authTag, ciphertext]);
  return envelope.toString("base64");
}

/**
 * Decrypt a base64 envelope produced by `encrypt`.
 * Throws on malformed input or auth-tag mismatch.
 */
export function decrypt(envelope: string): string {
  const key = getKey();
  const buf = Buffer.from(envelope, "base64");
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("decrypt: envelope too short");
  }
  const iv = buf.subarray(0, IV_LEN);
  const authTag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv) as DecipherGCM;
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

/**
 * Build a redacted preview string for UI display: shows the last 4 chars
 * only. Works with any plaintext length; never returns the full key.
 */
export function redactKey(plaintext: string): string {
  if (typeof plaintext !== "string" || plaintext.length === 0) return "";
  const tail = plaintext.length >= 4 ? plaintext.slice(-4) : plaintext;
  return `sk-••••${tail}`;
}
