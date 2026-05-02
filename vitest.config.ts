import { defineConfig } from "vitest/config";

/**
 * Vitest config — Phase 4 unit-test surface.
 *
 * Tests live under `tests/unit/**`. We run them in the `node` environment
 * (no browser shim) and rely on `vite-tsconfig-paths` to resolve the `@/`
 * alias so unit files import from `src/lib/**` the same way runtime code does.
 *
 * Some unit tests touch modules that mark themselves `import "server-only"`.
 * Vitest's resolution treats that as a bare specifier and refuses to load —
 * `setupFiles` shims it away. (See `tests/setup.ts`.)
 *
 * Some modules (e.g. `src/lib/server/encryption.ts`) read from
 * `@/lib/env` at import time. The setup file injects placeholder values
 * for the env vars those imports require so the unit suite is self-
 * contained — no real `.env.local` needed.
 */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    globals: false,
    pool: "threads",
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/lib/**/*.ts"],
      exclude: [
        "src/lib/db/schema.ts",
        "src/lib/db/client.ts",
        "src/lib/types/index.ts",
      ],
    },
  },
});
