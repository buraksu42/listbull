import crypto from "node:crypto";

import { cookies } from "next/headers";

import { SESSION_COOKIE_NAME } from "@/lib/auth/cookie";
import { env } from "@/lib/env";

/**
 * Phase 1: minimal HMAC-signed session cookie.
 * Phase 2 will wire Better Auth's full plugin pattern; this is the bridge.
 *
 * Cookie shape: `<base64url(json payload)>.<base64url(hmac sha256)>`
 * Payload: { uid: string, iat: number, exp: number }
 */

const COOKIE_NAME = SESSION_COOKIE_NAME;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

type SessionPayload = {
  uid: string;
  iat: number;
  exp: number;
};

function sign(payload: string): string {
  return crypto
    .createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(payload)
    .digest("base64url");
}

function encodePayload(payload: SessionPayload): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json, "utf8").toString("base64url");
}

function decodePayload(encoded: string): SessionPayload | null {
  try {
    const json = Buffer.from(encoded, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as SessionPayload;
    if (
      typeof parsed.uid !== "string" ||
      typeof parsed.iat !== "number" ||
      typeof parsed.exp !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function setSessionCookie(userId: string): Promise<void> {
  const now = Date.now();
  const payload: SessionPayload = {
    uid: userId,
    iat: now,
    exp: now + SESSION_TTL_MS,
  };
  const encoded = encodePayload(payload);
  const signature = sign(encoded);
  const value = `${encoded}.${signature}`;

  const store = await cookies();
  store.set(COOKIE_NAME, value, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function getSessionUserId(): Promise<string | null> {
  const store = await cookies();
  const cookie = store.get(COOKIE_NAME);
  if (!cookie?.value) return null;

  const [encoded, signature] = cookie.value.split(".");
  if (!encoded || !signature) return null;

  const expected = sign(encoded);
  const provided = signature;
  if (expected.length !== provided.length) return null;
  if (
    !crypto.timingSafeEqual(
      Buffer.from(expected, "utf8"),
      Buffer.from(provided, "utf8"),
    )
  ) {
    return null;
  }

  const payload = decodePayload(encoded);
  if (!payload) return null;
  if (payload.exp < Date.now()) return null;

  return payload.uid;
}

export { SESSION_COOKIE_NAME };
