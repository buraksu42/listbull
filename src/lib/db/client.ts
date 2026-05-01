import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "@/lib/env";
import * as schema from "@/lib/db/schema";

const globalForDb = globalThis as unknown as {
  __pg?: ReturnType<typeof postgres>;
  __db?: ReturnType<typeof drizzle<typeof schema>>;
};

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
