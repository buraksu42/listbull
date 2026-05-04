/**
 * Executor: `update_list` — rename + re-emoji.
 *
 * Owner-only. Inbox is updatable too (display string is a user
 * preference; is_inbox flag is intentionally not exposed).
 */
import "server-only";

import { and, eq, ilike } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, listMembers, lists } from "@/lib/db/schema";
import {
  updateListInputSchema,
  type UpdateListOutput,
} from "@/lib/ai/tools";
import { toListSnapshot } from "@/lib/db/snapshots";
import { ERR, err, ok } from "./_shared";

import type { ExecResult } from "./_shared";

export async function executeUpdateList(
  input: unknown,
  ctx: { userId: string },
): Promise<ExecResult<UpdateListOutput>> {
  const parsed = updateListInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const { list_id, list_name, name, emoji } = parsed.data;

  // Resolve list (owner-only path — search list_members for owner role).
  const found = await resolveOwnedList(ctx.userId, list_id, list_name);
  if (found.kind === "not_found") {
    return err(ERR.not_found, "No list found you own with that id/name.");
  }
  if (found.kind === "ambiguous") {
    return err(
      ERR.ambiguous_list,
      `Multiple lists matched: ${found.candidates.join(", ")}.`,
    );
  }
  const current = found.list;

  // Compute the patch + which fields actually changed.
  const changes: Array<"name" | "emoji"> = [];
  const patch: Partial<typeof lists.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (name !== undefined && name !== current.name) {
    patch.name = name;
    changes.push("name");
  }
  if (emoji !== undefined && emoji !== current.emoji) {
    patch.emoji = emoji ?? null;
    changes.push("emoji");
  }

  if (changes.length === 0) {
    // Idempotent no-op: requested state matches current; skip activity_log.
    return ok({
      list: { id: current.id, name: current.name, emoji: current.emoji },
      changes: [],
    });
  }

  return await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(lists)
      .set(patch)
      .where(eq(lists.id, current.id))
      .returning();
    if (!updated) throw new Error("update-list: update returned no row");

    await tx.insert(activityLog).values({
      listId: updated.id,
      entityType: "list",
      entityId: updated.id,
      action: "list_renamed",
      actorId: ctx.userId,
      payloadBefore: toListSnapshot(current),
      payloadAfter: toListSnapshot(updated),
    });

    return ok({
      list: { id: updated.id, name: updated.name, emoji: updated.emoji },
      changes,
    });
  });
}

type Resolution =
  | {
      kind: "ok";
      list: typeof lists.$inferSelect;
    }
  | { kind: "not_found" }
  | { kind: "ambiguous"; candidates: string[] };

async function resolveOwnedList(
  userId: string,
  list_id: string | undefined,
  list_name: string | undefined,
): Promise<Resolution> {
  if (list_id) {
    const row = await db.query.lists.findFirst({
      where: eq(lists.id, list_id),
    });
    if (!row) return { kind: "not_found" };
    const member = await db.query.listMembers.findFirst({
      where: and(
        eq(listMembers.listId, row.id),
        eq(listMembers.userId, userId),
        eq(listMembers.role, "owner"),
      ),
    });
    if (!member) return { kind: "not_found" };
    return { kind: "ok", list: row };
  }

  // Resolve by name. Caller must own the list.
  const rows = await db
    .select({ list: lists })
    .from(listMembers)
    .innerJoin(lists, eq(listMembers.listId, lists.id))
    .where(
      and(
        eq(listMembers.userId, userId),
        eq(listMembers.role, "owner"),
        ilike(lists.name, list_name ?? ""),
      ),
    );
  if (rows.length === 0) return { kind: "not_found" };
  if (rows.length > 1) {
    return {
      kind: "ambiguous",
      candidates: rows.map((r) => r.list.name),
    };
  }
  const first = rows[0];
  if (!first) return { kind: "not_found" };
  return { kind: "ok", list: first.list };
}
