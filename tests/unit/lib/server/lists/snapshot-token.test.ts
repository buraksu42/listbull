/**
 * D2 snapshot URL signing tests — Inv-18.
 *
 * Reviewer's security pass:
 *   - HMAC verifies success only when the signature matches.
 *   - Constant-time compare via `timingSafeEqual` (length check first).
 *   - Expired tokens reject with `expired`.
 *   - Tampered tokens reject with `invalid`.
 *   - Generation produces parseable + verifiable URLs.
 */
import { describe, expect, it } from "vitest";

import {
  computeSnapshotHmac,
  generateSnapshotUrl,
  verifySnapshotToken,
} from "@/lib/server/lists/snapshot-token";

const LIST_ID = "11111111-2222-3333-4444-555555555555";

describe("computeSnapshotHmac", () => {
  it("is deterministic for the same input", () => {
    const a = computeSnapshotHmac(LIST_ID, 1_700_000_000_000);
    const b = computeSnapshotHmac(LIST_ID, 1_700_000_000_000);
    expect(a).toBe(b);
  });

  it("changes when listId changes", () => {
    const a = computeSnapshotHmac(LIST_ID, 1_700_000_000_000);
    const b = computeSnapshotHmac(`${LIST_ID}-x`, 1_700_000_000_000);
    expect(a).not.toBe(b);
  });

  it("changes when exp changes", () => {
    const a = computeSnapshotHmac(LIST_ID, 1_700_000_000_000);
    const b = computeSnapshotHmac(LIST_ID, 1_700_000_001_000);
    expect(a).not.toBe(b);
  });

  it("returns base64url (no '+', '/', or '=' chars)", () => {
    const sig = computeSnapshotHmac(LIST_ID, Date.now());
    expect(sig).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("generateSnapshotUrl", () => {
  it("returns a URL parseable by URL() and containing exp + token", () => {
    const { url, exp, expiresAt } = generateSnapshotUrl(LIST_ID);
    const parsed = new URL(url);
    expect(parsed.pathname).toBe(`/snapshot/${LIST_ID}`);
    expect(parsed.searchParams.get("exp")).toBe(String(exp));
    expect(parsed.searchParams.get("token")).toBeTruthy();
    expect(new Date(expiresAt).getTime()).toBe(exp);
  });

  it("respects custom ttl", () => {
    const before = Date.now();
    const { exp } = generateSnapshotUrl(LIST_ID, 60_000);
    expect(exp - before).toBeGreaterThanOrEqual(59_000);
    expect(exp - before).toBeLessThanOrEqual(61_000);
  });
});

describe("verifySnapshotToken", () => {
  it("accepts a freshly generated token", () => {
    const { exp } = generateSnapshotUrl(LIST_ID);
    const token = computeSnapshotHmac(LIST_ID, exp);
    expect(verifySnapshotToken(LIST_ID, String(exp), token)).toEqual({
      ok: true,
    });
  });

  it("rejects when exp is missing", () => {
    expect(verifySnapshotToken(LIST_ID, null, "anything")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("rejects when token is missing", () => {
    expect(verifySnapshotToken(LIST_ID, String(Date.now() + 60_000), null)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("rejects an exp in the past with reason='expired'", () => {
    const past = Date.now() - 1000;
    const token = computeSnapshotHmac(LIST_ID, past);
    expect(verifySnapshotToken(LIST_ID, String(past), token)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("rejects when listId differs from the signed listId (forgery resistance)", () => {
    const exp = Date.now() + 60_000;
    const tokenForOtherList = computeSnapshotHmac("other-list-id", exp);
    expect(
      verifySnapshotToken(LIST_ID, String(exp), tokenForOtherList),
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a tampered token (single-byte flip)", () => {
    const exp = Date.now() + 60_000;
    const real = computeSnapshotHmac(LIST_ID, exp);
    const tampered = real.replace(/^./, real[0] === "A" ? "B" : "A");
    expect(verifySnapshotToken(LIST_ID, String(exp), tampered)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("rejects a non-numeric exp string", () => {
    const token = computeSnapshotHmac(LIST_ID, Date.now() + 60_000);
    expect(verifySnapshotToken(LIST_ID, "not-a-number", token)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("rejects when token length differs from expected (length-first short circuit)", () => {
    const exp = Date.now() + 60_000;
    expect(verifySnapshotToken(LIST_ID, String(exp), "short")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});
