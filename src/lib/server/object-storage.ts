/**
 * F1 — minimal S3-compatible Object Storage helper (Phase 4).
 *
 * Hetzner Object Storage speaks S3 (SigV4). To avoid adding the
 * `@aws-sdk/client-s3` dependency for a single one-shot upload, this
 * module implements just the surface area we need:
 *
 *   - `uploadAndPresign(key, body, contentType)` — PUTs the body and
 *     returns a 24h pre-signed GET URL the client can download from.
 *
 * The implementation is "best effort" per the Phase 4 contract: the
 * route handler calls `objectStorageConfigured()` first; only if true
 * does it attempt the upload. Otherwise the export response falls back
 * to a base64 data URL.
 *
 * NOTE: the SigV4 implementation here is intentionally narrow — single-
 * shot PUT + presign GET only. If you need multipart uploads, list-objects,
 * or anything else, install `@aws-sdk/client-s3`. The pre-signed URL
 * uses the AWS SigV4 query-string signing flavor (`AWS4-HMAC-SHA256`).
 */
import "server-only";

import crypto from "node:crypto";

import { env } from "@/lib/env";

type ObjectStorageConfig = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKey: string;
  secretKey: string;
};

function readConfig(): ObjectStorageConfig | null {
  const endpoint = env.HETZNER_OBJECT_STORAGE_ENDPOINT;
  const bucket = env.HETZNER_OBJECT_STORAGE_BUCKET;
  const region = env.HETZNER_OBJECT_STORAGE_REGION;
  const accessKey = env.HETZNER_OBJECT_STORAGE_ACCESS_KEY;
  const secretKey = env.HETZNER_OBJECT_STORAGE_SECRET_KEY;
  if (!endpoint || !bucket || !region || !accessKey || !secretKey) {
    return null;
  }
  return { endpoint, bucket, region, accessKey, secretKey };
}

export function objectStorageConfigured(): boolean {
  return readConfig() !== null;
}

const SERVICE = "s3";
const DEFAULT_GET_TTL_SEC = 24 * 60 * 60;

function sha256Hex(input: string | Buffer): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function hmacSha256(
  key: Buffer | string,
  data: string,
): Buffer {
  return crypto.createHmac("sha256", key).update(data).digest();
}

function deriveSigningKey(
  secretKey: string,
  date: string,
  region: string,
): Buffer {
  const kDate = hmacSha256(`AWS4${secretKey}`, date);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, SERVICE);
  return hmacSha256(kService, "aws4_request");
}

function isoBasic(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * Upload a payload (one PUT) + return a 24h pre-signed GET URL.
 */
export async function uploadAndPresign(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<{ url: string; expiresAt: string } | null> {
  const cfg = readConfig();
  if (!cfg) return null;

  // Endpoint shape: https://<region>.your-objectstorage.com — bucket
  // is path-style or virtual-hosted depending on Hetzner config.
  // We use path-style for portability.
  const baseUrl = new URL(cfg.endpoint);
  const host = baseUrl.host;
  const objectPath = `/${cfg.bucket}/${encodeKey(key)}`;
  const fullUrl = `${baseUrl.origin}${objectPath}`;

  // ─── PUT (signed via Authorization header) ───────────────────────
  const now = new Date();
  const amzDate = isoBasic(now);
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const credentialScope = `${date}/${cfg.region}/${SERVICE}/aws4_request`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const canonicalRequest = [
    "PUT",
    objectPath,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = deriveSigningKey(cfg.secretKey, date, cfg.region);
  const signature = crypto
    .createHmac("sha256", signingKey)
    .update(stringToSign)
    .digest("hex");
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const putResp = await fetch(fullUrl, {
    method: "PUT",
    headers: {
      authorization,
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      "content-type": contentType,
    },
    // Buffer → Uint8Array for `BodyInit` compatibility with WHATWG fetch.
    body: new Uint8Array(body),
  });
  if (!putResp.ok) {
    console.error("[object-storage] PUT failed", {
      status: putResp.status,
      statusText: putResp.statusText,
    });
    return null;
  }

  // ─── Pre-signed GET URL ──────────────────────────────────────────
  const presigned = presignGet(cfg, key, DEFAULT_GET_TTL_SEC, now);
  return {
    url: presigned,
    expiresAt: new Date(now.getTime() + DEFAULT_GET_TTL_SEC * 1000).toISOString(),
  };
}

function presignGet(
  cfg: ObjectStorageConfig,
  key: string,
  ttlSec: number,
  now: Date,
): string {
  const baseUrl = new URL(cfg.endpoint);
  const host = baseUrl.host;
  const objectPath = `/${cfg.bucket}/${encodeKey(key)}`;
  const amzDate = isoBasic(now);
  const date = amzDate.slice(0, 8);
  const credentialScope = `${date}/${cfg.region}/${SERVICE}/aws4_request`;
  const signedHeaders = "host";
  const params = new URLSearchParams();
  params.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
  params.set(
    "X-Amz-Credential",
    `${cfg.accessKey}/${credentialScope}`,
  );
  params.set("X-Amz-Date", amzDate);
  params.set("X-Amz-Expires", String(ttlSec));
  params.set("X-Amz-SignedHeaders", signedHeaders);
  // SigV4 requires sorted canonical query string.
  const canonicalQuery = sortedQuery(params);
  const canonicalRequest = [
    "GET",
    objectPath,
    canonicalQuery,
    `host:${host}\n`,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = deriveSigningKey(cfg.secretKey, date, cfg.region);
  const signature = crypto
    .createHmac("sha256", signingKey)
    .update(stringToSign)
    .digest("hex");
  return `${baseUrl.origin}${objectPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

function sortedQuery(params: URLSearchParams): string {
  const entries = Array.from(params.entries()).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

function encodeKey(key: string): string {
  // S3 path encoding: encode each segment but keep `/`.
  return key
    .split("/")
    .map((seg) =>
      encodeURIComponent(seg).replace(/[!'()*]/g, (c) =>
        `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");
}
