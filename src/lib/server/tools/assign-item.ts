/**
 * Executor: `assign_item` (Phase 3).
 *
 * Resolves `assignee_username` (with or without leading @) against the
 * item's list members per Inv-12:
 *   1. Strip leading @, lower-case.
 *   2. Exact `lower(telegram_username)` match against list members.
 *   3. Fallback: case-insensitive prefix match on
 *      `lower(telegram_first_name)`.
 *   4. Multiple candidates → `assignee_ambiguous`.
 *   5. Zero matches → `not_a_member`.
 *
 * `assignee_username: null` clears the assignee.
 *
 * Inv-12: assignee MUST be a current member of the list. Resolution is
 * membership-scoped (joined to `list_members`), so a non-member match
 * is impossible.
 */
import "server-only";

import { and, eq, ilike, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, items, listMembers, users } from "@/lib/db/schema";
import {
  assignItemInputSchema,
  type AssignItemOutput,
} from "@/lib/ai/tools";
import { ERR, err, escapeLike, ok, toItemSnapshot } from "./_shared";
import { userCanWriteList } from "@/lib/db/queries/items";

import type { ExecResult } from "./_shared";

export async function executeAssignItem(
  input: unknown,
  ctx: { userId: string },
): Promise<ExecResult<AssignItemOutput>> {
  const parsed = assignItemInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const { item_id, assignee_username } = parsed.data;

  return await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(items)
      .where(eq(items.id, item_id))
      .limit(1);
    if (!current || current.archivedAt) {
      return err(ERR.not_found, "Item not found.");
    }

    const allowed = await userCanWriteList(ctx.userId, current.listId);
    if (!allowed) {
      return err(ERR.forbidden, "You don't have access to that list.");
    }

    const previousAssigneeId = current.assigneeId;
    let nextAssigneeId: string | null = null;
    let resolvedUser: {
      id: string;
      telegramUsername: string | null;
      telegramFirstName: string;
    } | null = null;

    if (assignee_username === null) {
      nextAssigneeId = null;
    } else {
      const raw = assignee_username.trim();
      const stripped = raw.replace(/^@/, "");
      const lowered = stripped.toLowerCase();
      if (lowered.length === 0) {
        return err(ERR.invalid_input, "assignee_username is empty.");
      }

      // Step 1: exact lower(telegram_username) match, scoped to list members.
      const exact = await tx
        .select({
          id: users.id,
          telegramUsername: users.telegramUsername,
          telegramFirstName: users.telegramFirstName,
        })
        .from(users)
        .innerJoin(listMembers, eq(listMembers.userId, users.id))
        .where(
          and(
            eq(listMembers.listId, current.listId),
            sql`lower(${users.telegramUsername}) = ${lowered}`,
          ),
        );

      if (exact.length === 1 && exact[0]) {
        resolvedUser = exact[0];
      } else if (exact.length > 1) {
        return err(
          "assignee_ambiguous",
          `Multiple members match @${lowered}: ${exact
            .map((u) => u.telegramFirstName)
            .join(", ")}`,
        );
      } else {
        // Step 2: prefix match against telegram_first_name.
        const fuzzy = await tx
          .select({
            id: users.id,
            telegramUsername: users.telegramUsername,
            telegramFirstName: users.telegramFirstName,
          })
          .from(users)
          .innerJoin(listMembers, eq(listMembers.userId, users.id))
          .where(
            and(
              eq(listMembers.listId, current.listId),
              ilike(
                users.telegramFirstName,
                `${escapeLike(stripped)}%`,
              ),
            ),
          );

        if (fuzzy.length === 1 && fuzzy[0]) {
          resolvedUser = fuzzy[0];
        } else if (fuzzy.length > 1) {
          return err(
            "assignee_ambiguous",
            `Multiple members match "${stripped}": ${fuzzy
              .map((u) => u.telegramFirstName)
              .join(", ")}`,
          );
        } else {
          return err(
            "not_a_member",
            `${stripped} is not a member of this list.`,
          );
        }
      }

      nextAssigneeId = resolvedUser.id;
    }

    // No-op: same assignee.
    if (nextAssigneeId === previousAssigneeId) {
      return ok({
        item: toItemSnapshot(current),
        assignee: resolvedUser,
        previousAssigneeId,
      });
    }

    const now = new Date();
    const [updated] = await tx
      .update(items)
      .set({ assigneeId: nextAssigneeId, updatedAt: now })
      .where(eq(items.id, item_id))
      .returning();
    if (!updated) {
      throw new Error("assign-item: update returned no row");
    }

    const action = nextAssigneeId === null ? "item_unassigned" : "item_assigned";
    await tx.insert(activityLog).values({
      listId: updated.listId,
      entityType: "item",
      entityId: updated.id,
      action,
      actorId: ctx.userId,
      payloadBefore: toItemSnapshot(current),
      payloadAfter: toItemSnapshot(updated),
    });

    return ok({
      item: toItemSnapshot(updated),
      assignee: resolvedUser,
      previousAssigneeId,
    });
  });
}
