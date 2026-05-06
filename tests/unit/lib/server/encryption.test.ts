/**
 * AES-256-GCM round-trip tests for `src/lib/server/encryption.ts`.
 *
 * Phase 4 strict gate: encrypt/decrypt round-trip; auth-tag mismatch
 * throws; redactKey shape preserved. Inv-8 (BYOK key flow).
 */
import { describe, expect, it } from "vitest";

import { decrypt, encrypt, redactKey } from "@/lib/server/encryption";

describe("encryption: AES-256-GCM round-trip", () => {
  it("encrypts then decrypts plaintext back to the original string", () => {
    const plaintext = "sk-or-v1-abcdef0123456789";
    const envelope = encrypt(plaintext);
    expect(envelope).not.toContain(plaintext);
    expect(decrypt(envelope)).toBe(plaintext);
  });

  it("produces a different ciphertext per call (random IV)", () => {
    const plaintext = "same-plaintext";
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(plaintext);
    expect(decrypt(b)).toBe(plaintext);
  });

  it("handles unicode plaintext", () => {
    const plaintext = "açgözlü-kedi-🐈‍⬛";
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });

  it("throws on a tampered envelope (auth-tag mismatch)", () => {
    const envelope = encrypt("secret-payload");
    const buf = Buffer.from(envelope, "base64");
    // Flip a byte deep in the ciphertext (past iv + tag).
    buf[buf.length - 1] = buf[buf.length - 1]! ^ 0xff;
    const tampered = buf.toString("base64");
    expect(() => decrypt(tampered)).toThrow();
  });

  it("throws on a too-short envelope", () => {
    const tooShort = Buffer.from([0x00, 0x01, 0x02]).toString("base64");
    expect(() => decrypt(tooShort)).toThrow(/envelope too short/);
  });
});

describe("redactKey", () => {
  it("returns 'sk-••••' + last 4 chars for typical keys", () => {
    expect(redactKey("sk-or-v1-foo-bar-baz-1234")).toBe("sk-••••1234");
  });

  it("falls back to the full plaintext when shorter than 4 chars", () => {
    expect(redactKey("ab")).toBe("sk-••••ab");
  });

  it("returns empty string for empty input", () => {
    expect(redactKey("")).toBe("");
  });
});
