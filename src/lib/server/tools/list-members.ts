/**
 * Executor: `list_members` — read-only enumeration of a list's members.
 *
 * Any role can call this (owner/editor/viewer), so the membership gate
 * uses any-role visibility (not WRITE_ROLES). Resolves the list by
 * id or name, then thin-wraps `listMembersForList` to flatten the
 * Drizzle row into the LLM-friendly shape.
 */
import "server-only";

import { and, eq, ilike, isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { listMembers, lists } from "@/lib/db/schema";
import {
  listMembersInputSchema,
  type ListMembersOutput,
} from "@/lib/ai/tools";
import { listMembersForList } from "@/lib/db/queries/members";
import { ERR, err, ok } from "./_shared";

import type { ListRole } from "@/lib/types";
import type { ExecResult } from "./_shared";

export async function executeListMembers(
  input: unknown,
  ctx: { userId: string },
): Promise<ExecResult<ListMembersOutput>> {
  const parsed = listMembersInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const { list_id, list_name } = parsed.data;

  const found = await resolveAccessibleList(ctx.userId, list_id, list_name);
  if (found.kind === "not_found") {
    return err(ERR.not_found, "No list found with that id/name.");
  }
  if (found.kind === "ambiguous") {
    return err(
      ERR.ambiguous_list,
      `Multiple lists matched: ${found.candidates.join(", ")}.`,
    );
  }
  if (found.kind === "forbidden") {
    return err(ERR.forbidden, "You don't have access to that list.");
  }
  const list = found.list;

  const members = await listMembersForList(list.id);

  return ok({
    list: { id: list.id, name: list.name, emoji: list.emoji },
    members: members.map((m) => ({
      user_id: m.userId,
      telegram_username: m.user.telegramUsername,
      telegram_first_name: m.user.telegramFirstName,
      role: m.role as ListRole,
      joined_at: m.acceptedAt,
    })),
  });
}

type Resolution =
  | { kind: "ok"; list: typeof lists.$inferSelect }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "ambiguous"; candidates: string[] };

async function resolveAccessibleList(
  userId: string,
  list_id: string | undefined,
  list_name: string | undefined,
): Promise<Resolution> {
  if (list_id) {
    const row = await db.query.lists.findFirst({
      where: and(eq(lists.id, list_id), isNull(lists.archivedAt)),
    });
    if (!row) return { kind: "not_found" };
    const member = await db.query.listMembers.findFirst({
      where: and(
        eq(listMembers.listId, row.id),
        eq(listMembers.userId, userId),
      ),
    });
    if (!member) return { kind: "forbidden" };
    return { kind: "ok", list: row };
  }

  // Resolve by name. Caller must be a member (any role).
  const rows = await db
    .select({ list: lists })
    .from(listMembers)
    .innerJoin(lists, eq(listMembers.listId, lists.id))
    .where(
      and(
        eq(listMembers.userId, userId),
        ilike(lists.name, list_name ?? ""),
        isNull(lists.archivedAt),
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
