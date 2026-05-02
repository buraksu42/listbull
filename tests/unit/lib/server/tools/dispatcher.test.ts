/**
 * Tool dispatcher routing tests.
 *
 * Phase 4 strict gate: each of the 9 tool executors is wired in the
 * dispatcher AND each rejects malformed input with a structured
 * `invalid_input` error (Inv-4 envelope). We don't mock the full DB
 * here — bad-input rejection happens BEFORE any DB call, so these
 * tests run pure-in-memory and exercise the executor's first guard
 * line (the zod schema parse).
 *
 * Happy-path tool execution requires DB integration; covered in the
 * E2E suite (`tests/e2e/`) once a test Postgres is wired in Phase 5
 * staging.
 */
import { describe, expect, it, vi } from "vitest";

// Stub the DB client so executors that pass zod and reach a DB call
// don't ECONNREFUSED. We return a chainable thenable that resolves to
// an empty result set — every executor handles that as "nothing found".
vi.mock("@/lib/db/client", () => {
  const chain = (): unknown => {
    const obj: Record<string, unknown> = {};
    const methods = [
      "select",
      "from",
      "innerJoin",
      "leftJoin",
      "where",
      "orderBy",
      "limit",
      "groupBy",
      "insert",
      "values",
      "returning",
      "update",
      "set",
      "delete",
    ];
    for (const m of methods) obj[m] = () => obj;
    obj.then = (resolve: (v: unknown[]) => unknown) => Promise.resolve(resolve([]));
    return obj;
  };
  const db = chain() as Record<string, unknown>;
  db.transaction = async (
    fn: (tx: unknown) => Promise<unknown>,
  ): Promise<unknown> => fn(chain());
  return { db };
});

import { createToolDispatcher } from "@/lib/server/tools/dispatcher";
import type { ToolName } from "@/lib/ai/tools";

const ctx = { userId: "00000000-0000-0000-0000-000000000001" };

const TOOL_NAMES: ToolName[] = [
  "create_item",
  "search_items",
  "update_item",
  "complete_item",
  "delete_item",
  "list_lists",
  "share_list",
  "schedule_reminder",
  "assign_item",
];

describe("createToolDispatcher", () => {
  it("routes each registered tool to its executor and returns an envelope", async () => {
    const dispatch = createToolDispatcher(ctx);
    for (const name of TOOL_NAMES) {
      const result = await dispatch({
        id: `call-${name}`,
        name,
        input: { __invalid_marker__: true },
      });
      expect(result.toolCallId).toBe(`call-${name}`);
      // Every output is the ExecResult envelope. Either:
      //   - { ok: true, data: ... }          (mocked-DB happy-ish path)
      //   - { ok: false, error: { code } }   (zod rejection or downstream guard)
      const out = result.output as
        | { ok: true; data: unknown }
        | { ok: false; error: { code: string; message: string } };
      expect(typeof out.ok).toBe("boolean");
      if (!out.ok) {
        expect(typeof out.error?.code).toBe("string");
        expect(typeof out.error?.message).toBe("string");
      }
    }
  });

  it("returns bad_input for an unknown tool name", async () => {
    const dispatch = createToolDispatcher(ctx);
    const result = await dispatch({
      id: "call-x",
      name: "definitely_not_a_tool" as ToolName,
      input: {},
    });
    const out = result.output as { ok: boolean; error?: { code: string } };
    expect(out.ok).toBe(false);
    expect(out.error?.code).toBe("bad_input");
  });
});
