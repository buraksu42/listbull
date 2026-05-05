/**
 * License-verify middleware (Phase 4.5: SKELETON, default DISABLED).
 *
 * Self-host operators set `LICENSE_VERIFY_ENABLED=true` + supply
 * `LICENSE_PUBLIC_KEY` (Ed25519 PEM) + `LICENSE_KEY` (signed JWT) to
 * unlock Team / Workspace tier features locally. SaaS deployments
 * leave the gate disabled — tier enforcement at SaaS comes from
 * Stripe / Iyzico subscription state.
 *
 * Phase 4.5 ships:
 *  - signature verification helper (`verifyLicense`)
 *  - middleware shell (`requireLicense`) gated by env flag
 *
 * Phase 6 ships (NOT in 4.5):
 *  - License issuance endpoint at listbull.net SaaS
 *  - Admin dashboard for self-host operators
 *  - Revocation list distribution
 *
 * The JWT payload shape is FROZEN in `src/lib/types/billing.ts`
 * (`LicensePayload`). Phase 6 implementation = "fill in the
 * issuer + revocation list"; no schema or middleware shape change.
 */
import "server-only";

import {
  createPublicKey,
  createVerify,
  type KeyObject,
} from "node:crypto";

import { env } from "@/lib/env";
import type { LicensePayload, LicenseVerifyResult } from "@/lib/types";

let cachedPublicKey: KeyObject | null = null;
let cachedKeyMaterial: string | null = null;

function loadPublicKey(): KeyObject | null {
  const material = env.LICENSE_PUBLIC_KEY;
  if (!material) return null;
  if (cachedPublicKey && cachedKeyMaterial === material) {
    return cachedPublicKey;
  }
  cachedPublicKey = createPublicKey({ key: material, format: "pem" });
  cachedKeyMaterial = material;
  return cachedPublicKey;
}

function decodeBase64Url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

/**
 * Verify a JWT-formatted license against the configured public key.
 * Returns the parsed payload on success, or a discriminated error
 * variant the admin dashboard surfaces to the operator.
 *
 * Algorithm: EdDSA (Ed25519). The license issuer signs with the
 * private half; this verifier reads the public half from
 * `LICENSE_PUBLIC_KEY` env.
 */
export function verifyLicense(jwt: string): LicenseVerifyResult {
  const publicKey = loadPublicKey();
  if (!publicKey) {
    return { ok: false, reason: "missing_key" };
  }

  const parts = jwt.split(".");
  if (parts.length !== 3) {
    return { ok: false, reason: "invalid_signature" };
  }
  const [headerB64, payloadB64, signatureB64] = parts as [
    string,
    string,
    string,
  ];

  let payload: LicensePayload;
  try {
    payload = JSON.parse(decodeBase64Url(payloadB64).toString("utf8")) as LicensePayload;
  } catch {
    return { ok: false, reason: "invalid_signature" };
  }

  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`);
  const signature = decodeBase64Url(signatureB64);
  const verifier = createVerify("SHA512");
  verifier.update(signingInput);
  const valid = verifier.verify(publicKey, signature);
  if (!valid) {
    return { ok: false, reason: "invalid_signature" };
  }

  if (payload.exp !== undefined && payload.exp * 1000 < Date.now()) {
    return { ok: false, reason: "expired" };
  }

  // Phase 6 will check a revocation list here. For now the field is
  // populated by `LicensePayload` but not consulted.

  return { ok: true, payload };
}

/**
 * Middleware shell. Phase 4.5: when `LICENSE_VERIFY_ENABLED=false`
 * (default), every call passes — no licensing concept enforced. Phase
 * 6 deploys flip this true and gate Team/Workspace-tier features.
 *
 * The `workspaceId` argument is checked against
 * `LicensePayload.workspaces` allowlist when enforcement is on:
 * licenses bind to specific workspace_ids at issue time so revocation
 * is per-workspace.
 */
export type LicenseEnforceResult =
  | { enforced: false }
  | { enforced: true; reason: string };

export function requireLicense(workspaceId: string): LicenseEnforceResult {
  if (env.LICENSE_VERIFY_ENABLED !== "true") {
    return { enforced: false };
  }

  const license = env.LICENSE_KEY;
  if (!license) {
    return { enforced: true, reason: "missing_key" };
  }

  const result = verifyLicense(license);
  if (!result.ok) {
    return { enforced: true, reason: result.reason };
  }

  if (!result.payload.workspaces.includes(workspaceId)) {
    return { enforced: true, reason: "workspace_not_allowed" };
  }

  return { enforced: false };
}
