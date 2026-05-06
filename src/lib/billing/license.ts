/**
 * License JWT signer + issuer (Phase 6 SaaS-side).
 *
 * Self-host operator's verifier lives at
 * `src/lib/server/middleware/license-verify.ts` (uses the PUBLIC
 * half of the Ed25519 keypair). This module is the matched issuer
 * — it lives only in the SaaS codebase / under-secrecy ops scope,
 * gated by `LICENSE_PRIVATE_KEY` env. Self-host instances leave
 * the env unset; issuance there is a no-op.
 *
 * JWT format:
 *   header  = { alg: "EdDSA", typ: "JWT" }
 *   payload = LicensePayload (frozen in src/lib/types/billing.ts)
 *   sig     = Ed25519(privateKey, base64url(header) + "." + base64url(payload))
 *
 * The signature scheme matches `verifyLicense`'s SHA512 input — Ed25519
 * uses pre-hashing via SHA-512 internally.
 */
import "server-only";

import { randomUUID, createPrivateKey, createSign } from "node:crypto";

import { eq, isNotNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { licenses } from "@/lib/db/schema";
import { env } from "@/lib/env";
import type { LicensePayload, LicensePublic } from "@/lib/types";

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function loadPrivateKey() {
  if (!env.LICENSE_PRIVATE_KEY) return null;
  return createPrivateKey({
    key: env.LICENSE_PRIVATE_KEY,
    format: "pem",
  });
}

export type IssueLicenseInput = {
  tier: "team" | "workspace";
  seats: number;
  email: string;
  workspaces: string[];
  /** Optional explicit expiry; absent = perpetual. */
  expiresAt?: Date;
  sourceProvider?: "stripe" | "iyzico" | "manual";
  sourceReference?: string;
};

export type IssueLicenseResult =
  | { ok: true; jwt: string; license: LicensePublic }
  | { ok: false; reason: "no_private_key" | "invalid_input" };

/**
 * Sign + persist a new license. Returns the JWT to deliver to the
 * licensee — this is the ONLY time the JWT is exposed. The
 * `licenses` row's `key` column also stores it so the operator can
 * re-fetch from the admin dashboard if the licensee loses it.
 */
export async function issueLicense(
  input: IssueLicenseInput,
): Promise<IssueLicenseResult> {
  const priv = loadPrivateKey();
  if (!priv) return { ok: false, reason: "no_private_key" };

  if (
    !input.email ||
    input.seats <= 0 ||
    (input.tier !== "team" && input.tier !== "workspace") ||
    input.workspaces.length === 0
  ) {
    return { ok: false, reason: "invalid_input" };
  }

  const licenseId = randomUUID();
  const iat = Math.floor(Date.now() / 1000);
  const exp = input.expiresAt
    ? Math.floor(input.expiresAt.getTime() / 1000)
    : undefined;

  const payload: LicensePayload = {
    iss: "listbull.net",
    sub: licenseId,
    iat,
    ...(exp !== undefined ? { exp } : {}),
    tier: input.tier,
    seats: input.seats,
    workspaces: input.workspaces,
    email: input.email,
  };

  const header = { alg: "EdDSA", typ: "JWT" };
  const headerB64 = b64url(Buffer.from(JSON.stringify(header), "utf8"));
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), "utf8"));

  // Ed25519 verify uses SHA-512 internally; createSign("SHA512") +
  // sign(privateKey) matches the verifyLicense path.
  const signer = createSign("SHA512");
  signer.update(`${headerB64}.${payloadB64}`);
  const sigB64 = b64url(signer.sign(priv));

  const jwt = `${headerB64}.${payloadB64}.${sigB64}`;

  await db.insert(licenses).values({
    id: licenseId,
    key: jwt,
    tier: input.tier,
    seats: input.seats,
    issuedToEmail: input.email,
    workspaces: input.workspaces.join(","),
    expiresAt: input.expiresAt ?? null,
    sourceProvider: input.sourceProvider ?? "manual",
    sourceReference: input.sourceReference ?? null,
  });

  const publicView: LicensePublic = {
    id: licenseId,
    tier: input.tier,
    seats: input.seats,
    issuedToEmail: input.email,
    issuedAt: new Date(iat * 1000).toISOString(),
    expiresAt: input.expiresAt ? input.expiresAt.toISOString() : null,
    revokedAt: null,
    workspaces: input.workspaces,
  };

  return { ok: true, jwt, license: publicView };
}

/**
 * Mark a license revoked. Self-host instances that periodically
 * fetch the revocation list will reject the license thereafter;
 * SaaS-side verifiers (currently none — SaaS uses
 * subscriptions table) would consult this column directly.
 */
export async function revokeLicense(licenseId: string): Promise<boolean> {
  const result = await db
    .update(licenses)
    .set({ revokedAt: new Date() })
    .where(eq(licenses.id, licenseId))
    .returning({ id: licenses.id });
  return result.length > 0;
}

/**
 * Read all licenses (admin / operator surface). Excludes the JWT
 * itself; reveal-once mechanic. The JWT can still be re-fetched
 * via `getLicenseJwt(id)` for the issuer-operator if absolutely
 * needed (kept separate from the listing endpoint).
 */
export async function listLicenses(): Promise<LicensePublic[]> {
  const rows = await db.select().from(licenses);
  return rows.map((r) => ({
    id: r.id,
    tier: r.tier as "team" | "workspace",
    seats: r.seats,
    issuedToEmail: r.issuedToEmail,
    issuedAt: r.issuedAt.toISOString(),
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
    workspaces: r.workspaces ? r.workspaces.split(",") : [],
  }));
}

/**
 * Re-fetch the raw JWT for a license (operator-only, used when the
 * licensee loses the original delivery email). Treat this as a
 * sensitive operation; the admin endpoint MUST be gated by
 * LICENSE_ADMIN_TOKEN.
 */
export async function getLicenseJwt(licenseId: string): Promise<string | null> {
  const [row] = await db
    .select({ key: licenses.key })
    .from(licenses)
    .where(eq(licenses.id, licenseId))
    .limit(1);
  return row?.key ?? null;
}

/**
 * Build the revocation list export — the offline-distributable
 * artifact a self-host instance can periodically refresh against
 * (e.g. via a static URL the operator publishes). Format: newline-
 * separated license IDs (`sub` claim values), one per line.
 */
export async function buildRevocationList(): Promise<string> {
  const rows = await db
    .select({ id: licenses.id })
    .from(licenses)
    .where(isNotNull(licenses.revokedAt));
  return rows.map((r) => r.id).join("\n");
}
