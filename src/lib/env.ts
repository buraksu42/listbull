import { z } from "zod";

const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z.string().url(),

  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be ≥32 chars"),
  BETTER_AUTH_URL: z.string().url(),

  ENV_KEY: z
    .string()
    .min(32, "ENV_KEY must be a base64-encoded 32-byte key (≥32 chars)"),

  TELEGRAM_BOT_TOKEN: z.string().min(10, "TELEGRAM_BOT_TOKEN required"),
  TELEGRAM_WEBHOOK_SECRET: z
    .string()
    .min(16, "TELEGRAM_WEBHOOK_SECRET must be ≥16 chars"),
  TELEGRAM_BOT_USERNAME: z.string().min(3),

  OPENROUTER_API_KEY: z.string().optional(),

  // Operator-mode gate (post-billing-tear-out). When set, the operator
  // env-key fallback (env.OPENROUTER_API_KEY) only fires for workspaces
  // whose owner.telegram_id matches this value. Other workspaces must
  // BYOK or set a workspace org-key. Leaving this unset disables the
  // env-key fallback entirely — every workspace must bring its own key.
  // Numeric Telegram user id (e.g. 123456789).
  OPERATOR_TELEGRAM_ID: z.coerce.number().int().positive().optional(),

  LISTBULL_PER_USER_HOURLY_MSG_LIMIT: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(0),
  LISTBULL_HEARTBEAT_URL: z.string().url().optional(),

  // Phase 4 · F1: optional Hetzner Object Storage upload target for
  // export bundles. When unset, the export route falls back to a
  // base64 data-URL response so self-hosters with no Object Storage
  // can still export.
  HETZNER_OBJECT_STORAGE_ENDPOINT: z.string().url().optional(),
  HETZNER_OBJECT_STORAGE_BUCKET: z.string().min(1).optional(),
  HETZNER_OBJECT_STORAGE_REGION: z.string().min(1).optional(),
  HETZNER_OBJECT_STORAGE_ACCESS_KEY: z.string().min(1).optional(),
  HETZNER_OBJECT_STORAGE_SECRET_KEY: z.string().min(1).optional(),

  // Phase 4 · D2 (Inv-18): optional dedicated HMAC key for snapshot
  // URLs. When unset we fall back to BETTER_AUTH_SECRET.
  SNAPSHOT_SIGNING_KEY: z.string().min(32).optional(),

  // Phase 7: Upstash Redis (KV) for cross-pod webhook idempotency +
  // per-route rate limiting on admin surfaces. When unset, idempotency
  // falls back to in-memory single-pod cache and rate limiting becomes
  // a no-op. Both safe defaults — operator opts in by configuring the
  // env.
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
});

const clientSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_ENV: z.string().default("development"),
  NEXT_PUBLIC_UMAMI_WEBSITE_ID: z.string().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
});

type ServerEnv = z.infer<typeof serverSchema>;
type ClientEnv = z.infer<typeof clientSchema>;
type Env = ServerEnv & ClientEnv;

const isServer = typeof window === "undefined";

/**
 * Build-time tolerance: `next build` may run server modules without real env
 * present. We proxy access — return empty strings during build, fully validate
 * at runtime. SKIP_ENV_VALIDATION=1 forces this off for CI.
 */
const isBuildPhase =
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.SKIP_ENV_VALIDATION === "1";

let cachedServer: ServerEnv | null = null;
let cachedClient: ClientEnv | null = null;

function parseServer(): ServerEnv {
  if (cachedServer) return cachedServer;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    if (isBuildPhase) {
      // Best-effort placeholder during build — properties may be empty strings.
      cachedServer = serverSchema.parse({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://placeholder@localhost:5432/placeholder",
        BETTER_AUTH_SECRET: "x".repeat(32),
        BETTER_AUTH_URL: "http://localhost",
        ENV_KEY: "x".repeat(32),
        TELEGRAM_BOT_TOKEN: "0000000000",
        TELEGRAM_WEBHOOK_SECRET: "x".repeat(16),
        TELEGRAM_BOT_USERNAME: "listbull_bot",
        LISTBULL_PER_USER_HOURLY_MSG_LIMIT: 0,
      });
      return cachedServer;
    }
    console.error("❌ Invalid server env:", z.treeifyError(parsed.error));
    throw new Error("Invalid server environment variables");
  }
  cachedServer = parsed.data;
  return cachedServer;
}

function parseClient(): ClientEnv {
  if (cachedClient) return cachedClient;
  const raw = {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_ENV: process.env.NEXT_PUBLIC_ENV,
    NEXT_PUBLIC_UMAMI_WEBSITE_ID: process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  };
  const parsed = clientSchema.safeParse(raw);
  if (!parsed.success) {
    if (isBuildPhase) {
      cachedClient = clientSchema.parse({
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
        NEXT_PUBLIC_ENV: "production",
      });
      return cachedClient;
    }
    console.error("❌ Invalid client env:", z.treeifyError(parsed.error));
    throw new Error("Invalid client environment variables");
  }
  cachedClient = parsed.data;
  return cachedClient;
}

/**
 * Lazy proxy — properties validate on first access, not on module import.
 * This lets `next build` succeed without all env vars set.
 */
export const env: Env = new Proxy({} as Env, {
  get(_target, prop: string) {
    const client = parseClient();
    if (prop in client) return client[prop as keyof ClientEnv];
    if (!isServer) return undefined;
    const server = parseServer();
    return server[prop as keyof ServerEnv];
  },
});
