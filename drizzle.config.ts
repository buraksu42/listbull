import { defineConfig } from "drizzle-kit";

// generate works without a DB connection; migrate/studio need a real URL.
const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://placeholder@localhost:5432/placeholder";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: databaseUrl },
  casing: "snake_case",
  verbose: true,
  strict: true,
});
