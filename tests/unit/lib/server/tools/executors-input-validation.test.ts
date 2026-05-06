/**
 * Per-executor input-validation tests (Phase 4 strict gate "≥1 test
 * per executor").
 *
 * Every executor's first line is `<tool>InputSchema.safeParse(input)`;
 * if it fails, the executor returns `{ ok:false, error:{ code:
 * "invalid_input", … } }` BEFORE any DB touch. These tests prove:
 *
 *   1. Each executor exists and is exported (import-side).
 *   2. The schema gate rejects clearly-bad input.
 *   3. The error envelope shape (Inv-4) is preserved.
 *
 * Happy-path executor tests require live Postgres — covered by the
 * E2E suite (Phase 5 staging activation). Heavy DB mocking inside a
 * unit test would mostly duplicate the executor's logic and add no
 * value; we keep unit tests fast + pure here.
 */
import { describe, expect, it, vi } from "vitest";

// Stub the DB so any executor that passes zod (e.g. list_lists with the
// default `include_archived: false`) doesn't hit a real Postgres. The
// goal of THIS file is to prove zod rejection — not happy-path execution.
vi.mock("@/lib/db/client", () => {
  const chain = (): unknown => {
    const obj: Record<string, unknown> = {};
    const methods = [
      "select", "from", "innerJoin", "leftJoin", "where", "orderBy",
      "limit", "groupBy", "insert", "values", "returning", "update",
      "set", "delete",
    ];
    for (const m of methods) obj[m] = () => obj;
    obj.then = (resolve: (v: unknown[]) => unknown) =>
      Promise.resolve(resolve([]));
    return obj;
  };
  const db = chain() as Record<string, unknown>;
  db.transaction = async (
    fn: (tx: unknown) => Promise<unknown>,
  ): Promise<unknown> => fn(chain());
  return { db };
});

import { executeAssignItem } from "@/lib/server/tools/assign-item";
import { executeCompleteItem } from "@/lib/server/tools/complete-item";
import { executeCreateItem } from "@/lib/server/tools/create-item";
import { executeDeleteItem } from "@/lib/server/tools/delete-item";
import { executeInviteToWorkspace } from "@/lib/server/tools/invite-to-workspace";
import { executeListLists } from "@/lib/server/tools/list-lists";
import { executeRemoveWorkspaceMember } from "@/lib/server/tools/remove-workspace-member";
import { executeScheduleReminder } from "@/lib/server/tools/schedule-reminder";
import { executeSearchItems } from "@/lib/server/tools/search-items";
import { executeSetItemAttributes } from "@/lib/server/tools/set-item-attributes";
import { executeShareList } from "@/lib/server/tools/share-list";
import { executeSwitchWorkspace } from "@/lib/server/tools/switch-workspace";
import { executeUpdateItem } from "@/lib/server/tools/update-item";
import { executeUpdateWorkspace } from "@/lib/server/tools/update-workspace";

const CTX = {
  userId: "00000000-0000-0000-0000-000000000001",
  workspaceId: "00000000-0000-0000-0000-000000000002",
};

describe("create_item: input validation", () => {
  it("rejects empty text", async () => {
    const r = await executeCreateItem({ text: "" }, CTX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_input");
  });

  it("rejects text > 2000 chars", async () => {
    const r = await executeCreateItem({ text: "x".repeat(2001) }, CTX);
    expect(r.ok).toBe(false);
  });

  it("rejects garbage payload", async () => {
    const r = await executeCreateItem({ foo: "bar" }, CTX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_input");
  });
});

describe("search_items: input validation", () => {
  it("rejects malformed shape", async () => {
    const r = await executeSearchItems({ query: 42 }, CTX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_input");
  });
});

describe("update_item: input validation", () => {
  it("rejects missing item_id", async () => {
    const r = await executeUpdateItem({ text: "hi" }, CTX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_input");
  });

  it("rejects non-uuid item_id", async () => {
    const r = await executeUpdateItem(
      { item_id: "not-a-uuid", text: "hi" },
      CTX,
    );
    expect(r.ok).toBe(false);
  });
});

describe("complete_item: input validation", () => {
  it("rejects missing item_id", async () => {
    const r = await executeCompleteItem({}, CTX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_input");
  });
});

describe("delete_item: input validation", () => {
  it("rejects missing item_id", async () => {
    const r = await executeDeleteItem({}, CTX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_input");
  });
});

describe("list_lists: input validation", () => {
  it("rejects non-boolean include_archived", async () => {
    const r = await executeListLists({ include_archived: "yes" }, CTX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_input");
  });
});

describe("share_list: input validation", () => {
  it("rejects missing target", async () => {
    const r = await executeShareList({}, CTX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_input");
  });
});

describe("schedule_reminder: input validation", () => {
  it("rejects malformed datetime", async () => {
    const r = await executeScheduleReminder(
      { item_id: "00000000-0000-0000-0000-000000000010", due_at: "tomorrow" },
      CTX,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_input");
  });
});

describe("assign_item: input validation", () => {
  it("rejects missing fields", async () => {
    const r = await executeAssignItem({}, CTX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_input");
  });
});

// ─── Phase 4.5: workspace + item-discipline executors ───────────────

describe("switch_workspace: input validation", () => {
  it("rejects when neither workspace_id nor workspace_name provided", async () => {
    const r = await executeSwitchWorkspace({}, CTX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_input");
  });

  it("rejects non-uuid workspace_id", async () => {
    const r = await executeSwitchWorkspace(
      { workspace_id: "not-a-uuid" },
      CTX,
    );
    expect(r.ok).toBe(false);
  });
});

describe("list_workspaces: input validation", () => {
  // No fields to validate — schema is z.object({}). The executor's
  // unit-test surface here is "import + dispatch reach the executor
  // without throwing" which is already covered by dispatcher.test.ts.
  it.skip("trivial schema — covered by dispatcher.test.ts smoke", () => {
    // intentionally empty
  });
});

describe("update_workspace: input validation", () => {
  it("rejects missing name", async () => {
    const r = await executeUpdateWorkspace({}, CTX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_input");
  });

  it("rejects empty name", async () => {
    const r = await executeUpdateWorkspace({ name: "  " }, CTX);
    expect(r.ok).toBe(false);
  });

  it("rejects name > 120 chars", async () => {
    const r = await executeUpdateWorkspace({ name: "x".repeat(121) }, CTX);
    expect(r.ok).toBe(false);
  });
});

describe("invite_to_workspace: input validation", () => {
  it("rejects missing username", async () => {
    const r = await executeInviteToWorkspace({}, CTX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_input");
  });

  it("rejects empty username", async () => {
    const r = await executeInviteToWorkspace({ username: "" }, CTX);
    expect(r.ok).toBe(false);
  });

  it("rejects unknown role", async () => {
    const r = await executeInviteToWorkspace(
      { username: "ali", role: "superuser" },
      CTX,
    );
    expect(r.ok).toBe(false);
  });
});

describe("remove_workspace_member: input validation", () => {
  it("rejects when neither username nor user_id provided", async () => {
    const r = await executeRemoveWorkspaceMember({}, CTX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_input");
  });

  it("rejects non-uuid user_id", async () => {
    const r = await executeRemoveWorkspaceMember(
      { user_id: "not-a-uuid" },
      CTX,
    );
    expect(r.ok).toBe(false);
  });
});

describe("set_item_attributes: input validation", () => {
  it("rejects missing item_id", async () => {
    const r = await executeSetItemAttributes(
      { status: "blocked" },
      CTX,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_input");
  });

  it("rejects when no field supplied (item_id alone is meaningless)", async () => {
    const r = await executeSetItemAttributes(
      { item_id: "00000000-0000-0000-0000-000000000010" },
      CTX,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects unknown status value", async () => {
    const r = await executeSetItemAttributes(
      {
        item_id: "00000000-0000-0000-0000-000000000010",
        status: "in_review",
      },
      CTX,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects > 10 tags", async () => {
    const r = await executeSetItemAttributes(
      {
        item_id: "00000000-0000-0000-0000-000000000010",
        tags: Array.from({ length: 11 }, (_, i) => `tag${i}`),
      },
      CTX,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects unknown priority", async () => {
    const r = await executeSetItemAttributes(
      {
        item_id: "00000000-0000-0000-0000-000000000010",
        priority: "urgent",
      },
      CTX,
    );
    expect(r.ok).toBe(false);
  });
});
