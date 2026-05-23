import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "@/lib/env";
import * as schema from "@/lib/db/schema";

const globalForDb = globalThis as unknown as {
  __pg?: ReturnType<typeof postgres>;
  __db?: ReturnType<typeof drizzle<typeof schema>>;
};

// Loud warning when DATABASE_URL omits ssl mode in production —
// postgres-js defaults to ssl=false, and silently running unencrypted
// against a public-network Postgres is a leak surface. Dokploy's
// in-cluster Postgres is on a private docker network so ssl isn't
// strictly required there, but cross-host setups should set
// `sslmode=require`.
if (
  env.NODE_ENV === "production" &&
  !env.DATABASE_URL.includes("sslmode=")
) {
  console.warn(
    "[db] DATABASE_URL has no sslmode= parameter — confirm the Postgres link is on a private network or add sslmode=require",
  );
}

const client =
  globalForDb.__pg ??
  postgres(env.DATABASE_URL, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
  });

export const db =
  globalForDb.__db ?? drizzle(client, { schema, casing: "snake_case" });

if (env.NODE_ENV !== "production") {
  globalForDb.__pg = client;
  globalForDb.__db = db;
}
