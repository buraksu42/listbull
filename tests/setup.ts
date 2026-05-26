import { vi } from "vitest";

/**
 * Vitest setup — runs once per worker before any test file.
 *
 * Shims `import "server-only"` so modules using the Next.js server-only
 * marker can be loaded in the node test environment. The real package
 * throws on client-side load; in tests we just want a no-op.
 */
vi.mock("server-only", () => ({}));
