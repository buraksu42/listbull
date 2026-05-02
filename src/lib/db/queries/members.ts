/**
 * `list_members` query helpers.
 *
 * Member removal MUST clear any items where `assignee_id = removed_user_id`
 * for that list (Inv-12) and emit one `item_unassigned` activity row per
 * affected item, all in the same transaction as the membership delete.
 */
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  activityLog,
  items,
  listMembers,
  users,
} from "@/lib/db/schema";
import type {
  ListMember,
  ListRole,
  MemberSnapshot,
} from "@/lib/types";
import { toItemSnapshot } from "@/lib/server/tools/_shared";

export type MemberWithUser = {
  id: string;
  listId: string;
  userId: string;
  role: ListRole;
  invitedBy: string | null;
  /** ISO 8601 string */
  acceptedAt: string;
  /** ISO 8601 string */
  createdAt: string;
  /** ISO 8601 string */
  updatedAt: string;
  user: {
    telegramFirstName: string;
    telegramUsername: string | null;
    telegramPhotoUrl: string | null;
  };
};

/**
 * List all members of a list, joined to `users` for display.
 * Read-only; caller is responsible for the read-side membership gate.
 */
export async function listMembersForList(
  listId: string,
): Promise<MemberWithUser[]> {
  const rows = await db
    .select({
      id: listMembers.id,
      listId: listMembers.listId,
      userId: listMembers.userId,
      role: listMembers.role,
      invitedBy: listMembers.invitedBy,
      acceptedAt: listMembers.acceptedAt,
      createdAt: listMembers.createdAt,
      updatedAt: listMembers.updatedAt,
      telegramFirstName: users.telegramFirstName,
      telegramUsername: users.telegramUsername,
      telegramPhotoUrl: users.telegramPhotoUrl,
    })
    .from(listMembers)
    .innerJoin(users, eq(users.id, listMembers.userId))
    .where(eq(listMembers.listId, listId));

  return rows.map((r) => ({
    id: r.id,
    listId: r.listId,
    userId: r.userId,
    role: r.role as ListRole,
    invitedBy: r.invitedBy,
    acceptedAt: r.acceptedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    user: {
      telegramFirstName: r.telegramFirstName,
      telegramUsername: r.telegramUsername,
      telegramPhotoUrl: r.telegramPhotoUrl,
    },
  }));
}

/** Look up a single member row (any role); returns undefined if missing. */
export async function getListMember(
  listId: string,
  userId: string,
): Promise<ListMember | undefined> {
  return db.query.listMembers.findFirst({
    where: and(
      eq(listMembers.listId, listId),
      eq(listMembers.userId, userId),
    ),
  });
}

export async function isListOwner(
  listId: string,
  userId: string,
): Promise<boolean> {
  const member = await db.query.listMembers.findFirst({
    where: and(
      eq(listMembers.listId, listId),
      eq(listMembers.userId, userId),
      eq(listMembers.role, "owner"),
    ),
  });
  return !!member;
}

/**
 * Build a `MemberSnapshot` from a member row + its joined user info.
 */
export function toMemberSnapshot(
  member: ListMember,
  user: {
    telegramFirstName: string;
    telegramUsername: string | null;
    telegramPhotoUrl: string | null;
  },
): MemberSnapshot {
  return {
    id: member.id,
    listId: member.listId,
    userId: member.userId,
    role: member.role as ListRole,
    invitedBy: member.invitedBy,
    acceptedAt: member.acceptedAt.toISOString(),
    createdAt: member.createdAt.toISOString(),
    updatedAt: member.updatedAt.toISOString(),
    user: {
      telegramFirstName: user.telegramFirstName,
      telegramUsername: user.telegramUsername,
      telegramPhotoUrl: user.telegramPhotoUrl,
    },
  };
}

export type RemoveMemberResult =
  | { ok: true; removedItemCount: number }
  | { ok: false; code: string; message: string };

/**
 * Remove a member from a list (owner-only). In the same transaction
 * (Inv-1, Inv-12):
 *   - DELETE the list_members row.
 *   - For every item in the list with `assignee_id = removed_user_id`,
 *     UPDATE assignee_id = null and write one `item_unassigned`
 *     activity_log row.
 *   - Write one `member_removed` activity_log row.
 *
 * The owner cannot remove themselves via this path. Returns
 * `{ ok: false, code: 'forbidden' }` for non-owner callers and
 * `{ ok: false, code: 'cannot_remove_owner' }` for self-removal.
 */
export async function removeMember(
  listId: string,
  memberId: string,
  callerId: string,
): Promise<RemoveMemberResult> {
  return await db.transaction(async (tx) => {
    // Caller must be owner.
    const callerMember = await tx.query.listMembers.findFirst({
      where: and(
        eq(listMembers.listId, listId),
        eq(listMembers.userId, callerId),
      ),
    });
    if (!callerMember || callerMember.role !== "owner") {
      return {
        ok: false,
        code: "forbidden",
        message: "Only the list owner can remove members.",
      };
    }

    // Target member.
    const target = await tx.query.listMembers.findFirst({
      where: and(
        eq(listMembers.id, memberId),
        eq(listMembers.listId, listId),
      ),
    });
    if (!target) {
      return {
        ok: false,
        code: "not_found",
        message: "Member not found.",
      };
    }
    if (target.role === "owner") {
      return {
        ok: false,
        code: "cannot_remove_owner",
        message: "The owner cannot be removed from their own list.",
      };
    }

    const [targetUser] = await tx
      .select({
        telegramFirstName: users.telegramFirstName,
        telegramUsername: users.telegramUsername,
        telegramPhotoUrl: users.telegramPhotoUrl,
      })
      .from(users)
      .where(eq(users.id, target.userId))
      .limit(1);
    if (!targetUser) {
      return {
        ok: false,
        code: "not_found",
        message: "Target user not found.",
      };
    }

    // Inv-12: clear assignee_id on all items in this list assigned to
    // the removed user, and write one `item_unassigned` row per item.
    const affectedItems = await tx
      .select()
      .from(items)
      .where(and(eq(items.listId, listId), eq(items.assigneeId, target.userId)));

    const now = new Date();
    for (const item of affectedItems) {
      const before = toItemSnapshot(item);
      const [updated] = await tx
        .update(items)
        .set({ assigneeId: null, updatedAt: now })
        .where(eq(items.id, item.id))
        .returning();
      if (!updated) continue;

      await tx.insert(activityLog).values({
        listId,
        entityType: "item",
        entityId: updated.id,
        action: "item_unassigned",
        actorId: callerId,
        payloadBefore: before,
        payloadAfter: toItemSnapshot(updated),
      });
    }

    const memberSnapshot = toMemberSnapshot(target, targetUser);

    // DELETE the membership row.
    await tx.delete(listMembers).where(eq(listMembers.id, memberId));

    await tx.insert(activityLog).values({
      listId,
      entityType: "member",
      entityId: memberId,
      action: "member_removed",
      actorId: callerId,
      payloadBefore: memberSnapshot,
      payloadAfter: null,
    });

    return { ok: true, removedItemCount: affectedItems.length };
  });
}

export type UpdateMemberRoleResult =
  | { ok: true; member: MemberSnapshot }
  | { ok: false; code: string; message: string };

/**
 * Owner-only role change. Writes one `member_role_changed` activity row.
 * Phase 3 plumbing only — UI surface is Phase 4.
 */
export async function updateMemberRole(
  listId: string,
  memberId: string,
  newRole: ListRole,
  callerId: string,
): Promise<UpdateMemberRoleResult> {
  return await db.transaction(async (tx) => {
    const callerMember = await tx.query.listMembers.findFirst({
      where: and(
        eq(listMembers.listId, listId),
        eq(listMembers.userId, callerId),
      ),
    });
    if (!callerMember || callerMember.role !== "owner") {
      return {
        ok: false,
        code: "forbidden",
        message: "Only the list owner can change roles.",
      };
    }

    const target = await tx.query.listMembers.findFirst({
      where: and(
        eq(listMembers.id, memberId),
        eq(listMembers.listId, listId),
      ),
    });
    if (!target) {
      return {
        ok: false,
        code: "not_found",
        message: "Member not found.",
      };
    }
    if (target.role === "owner") {
      return {
        ok: false,
        code: "cannot_change_owner",
        message: "Cannot change the owner's role.",
      };
    }
    if (target.role === newRole) {
      const [user] = await tx
        .select({
          telegramFirstName: users.telegramFirstName,
          telegramUsername: users.telegramUsername,
          telegramPhotoUrl: users.telegramPhotoUrl,
        })
        .from(users)
        .where(eq(users.id, target.userId))
        .limit(1);
      if (!user) {
        return {
          ok: false,
          code: "not_found",
          message: "Target user not found.",
        };
      }
      // No-op: same role; skip activity_log write.
      return { ok: true, member: toMemberSnapshot(target, user) };
    }

    const [user] = await tx
      .select({
        telegramFirstName: users.telegramFirstName,
        telegramUsername: users.telegramUsername,
        telegramPhotoUrl: users.telegramPhotoUrl,
      })
      .from(users)
      .where(eq(users.id, target.userId))
      .limit(1);
    if (!user) {
      return {
        ok: false,
        code: "not_found",
        message: "Target user not found.",
      };
    }

    const before = toMemberSnapshot(target, user);

    const [updated] = await tx
      .update(listMembers)
      .set({ role: newRole, updatedAt: new Date() })
      .where(eq(listMembers.id, memberId))
      .returning();
    if (!updated) {
      throw new Error("updateMemberRole: update returned no row");
    }

    const after = toMemberSnapshot(updated, user);

    await tx.insert(activityLog).values({
      listId,
      entityType: "member",
      entityId: updated.id,
      action: "member_role_changed",
      actorId: callerId,
      payloadBefore: before,
      payloadAfter: after,
    });

    return { ok: true, member: after };
  });
}
