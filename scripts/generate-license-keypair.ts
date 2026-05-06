/**
 * Phase 6 helper: generate an Ed25519 keypair for license signing.
 *
 * Usage:
 *   npx tsx scripts/generate-license-keypair.ts
 *
 * Prints two PEM blocks to stdout:
 *   1. PRIVATE KEY  — set as LICENSE_PRIVATE_KEY on SaaS issuer (keep secret)
 *   2. PUBLIC KEY   — set as LICENSE_PUBLIC_KEY on every self-host
 *                     deployment that should accept licenses signed
 *                     by this private half
 *
 * Rotation: generate a new keypair, deploy the new public key to
 * self-host instances, then start signing with the new private key.
 * Old licenses verify against the OLD public key only; honor the
 * old key in parallel until all valid licenses have been re-issued
 * (or until the old key's licenses' max expiry is past).
 */
import { generateKeyPairSync } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");

console.log("=".repeat(64));
console.log("LICENSE_PRIVATE_KEY (SaaS issuer — KEEP SECRET, don't commit)");
console.log("=".repeat(64));
console.log(
  privateKey.export({ type: "pkcs8", format: "pem" }).toString().trim(),
);
console.log();
console.log("=".repeat(64));
console.log("LICENSE_PUBLIC_KEY (bundle with self-host deployments)");
console.log("=".repeat(64));
console.log(
  publicKey.export({ type: "spki", format: "pem" }).toString().trim(),
);
console.log();
console.log(
  "Wire LICENSE_PRIVATE_KEY into the SaaS issuer's env (Dokploy);",
);
console.log(
  "wire LICENSE_PUBLIC_KEY into every self-host instance's env.",
);
