/**
 * `list_invites` query helpers.
 *
 * The accept transaction lives in `acceptInvite` (Inv-1, Inv-13): we
 * lock the invite row, INSERT `list_members`, UPDATE the invite, and
 * write one `member_added` activity row in a single Drizzle
 * transaction. The route handler is a thin wrapper.
 */
import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  activityLog,
  listInvites,
  listMembers,
  lists,
  users,
} from "@/lib/db/schema";
import type { ListInvite, ListRole, MemberSnapshot } from "@/lib/types";

export async function getInviteByToken(
  token: string,
): Promise<ListInvite | undefined> {
  return db.query.listInvites.findFirst({
    where: eq(listInvites.token, token),
  });
}

export type InviteContext = {
  invite: ListInvite;
  list: { id: string; name: string; emoji: string | null };
  invitedByName: string;
};

/**
 * Read-only invite + list + inviter join used by the GET endpoint and
 * the accept transaction's pre-validation pass.
 */
export async function getInviteContextByToken(
  token: string,
): Promise<InviteContext | undefined> {
  const rows = await db
    .select({
      invite: listInvites,
      list: { id: lists.id, name: lists.name, emoji: lists.emoji },
      invitedByName: users.telegramFirstName,
    })
    .from(listInvites)
    .innerJoin(lists, eq(lists.id, listInvites.listId))
    .innerJoin(users, eq(users.id, listInvites.invitedBy))
    .where(eq(listInvites.token, token))
    .limit(1);

  return rows[0];
}

/**
 * Idempotency helper for `share_list`: find a pending (non-accepted,
 * non-expired) invite for `(list_id, lowered_username)` so re-tapping
 * `/share` reuses the existing token rather than creating a duplicate.
 */
export async function findPendingInvite(
  listId: string,
  loweredUsername: string,
): Promise<ListInvite | undefined> {
  const rows = await db
    .select()
    .from(listInvites)
    .where(
      and(
        eq(listInvites.listId, listId),
        eq(listInvites.invitedUsername, loweredUsername),
        isNull(listInvites.acceptedAt),
        sql`${listInvites.expiresAt} > now()`,
      ),
    )
    .limit(1);
  return rows[0];
}

export type AcceptInviteResult =
  | { ok: true; listId: string; alreadyAccepted: boolean }
  | { ok: false; code: string; message: string; listId?: string };

/**
 * Atomic accept transaction (Inv-1 + Inv-13).
 *
 * 1. SELECT ... FOR UPDATE on the invite (serialize concurrent accepts).
 * 2. Validate accepted_at IS NULL → `invite_already_accepted`.
 * 3. Validate expires_at > NOW() → `invite_expired`.
 * 4. Validate lower(caller.telegramUsername) === invite.invitedUsername.
 * 5. INSERT list_members (or recover gracefully if user is already in).
 * 6. UPDATE list_invites SET accepted_at, accepted_by_user_id.
 * 7. INSERT activity_log row `member_added` with MemberSnapshot.
 */
export async function acceptInvite(
  token: string,
  callerId: string,
): Promise<AcceptInviteResult> {
  return await db.transaction(async (tx) => {
    // FOR UPDATE on the invite row to serialize concurrent accepts.
    const lockedRows = await tx.execute<{
      id: string;
      list_id: string;
      invited_username: string;
      invited_by: string;
      role: string;
      expires_at: Date;
      accepted_at: Date | null;
      accepted_by_user_id: string | null;
    }>(
      sql`SELECT id, list_id, invited_username, invited_by, role, expires_at, accepted_at, accepted_by_user_id
          FROM list_invites
          WHERE token = ${token}
          FOR UPDATE`,
    );
    const inviteRow = lockedRows[0];
    if (!inviteRow) {
      return { ok: false, code: "not_found", message: "Invite not found." };
    }

    if (inviteRow.accepted_at) {
      return {
        ok: false,
        code: "invite_already_accepted",
        message: "This invite has already been accepted.",
        listId: inviteRow.list_id,
      };
    }

    const now = new Date();
    if (inviteRow.expires_at < now) {
      return {
        ok: false,
        code: "invite_expired",
        message: "This invite has expired.",
      };
    }

    // Caller's current telegram_username (lowered) must match the
    // invited_username on file. Phase 4 · P2-6: consolidated the prior
    // two SELECTs on `users` (one for the username check, one for the
    // snapshot enrichment) into a single round-trip.
    const [caller] = await tx
      .select({
        id: users.id,
        telegramUsername: users.telegramUsername,
        telegramFirstName: users.telegramFirstName,
        telegramPhotoUrl: users.telegramPhotoUrl,
      })
      .from(users)
      .where(eq(users.id, callerId))
      .limit(1);
    if (!caller) {
      return { ok: false, code: "not_found", message: "Caller not found." };
    }
    const callerLowered = (caller.telegramUsername ?? "").toLowerCase();
    if (
      callerLowered.length === 0 ||
      callerLowered !== inviteRow.invited_username
    ) {
      return {
        ok: false,
        code: "invite_username_mismatch",
        message: "This invite was sent to a different Telegram username.",
      };
    }

    // Recover gracefully: if the user is somehow already a member (e.g.
    // a parallel accept landed first), idempotently flip the invite
    // and return alreadyAccepted=true rather than throwing on the
    // `(list_id, user_id)` unique constraint.
    const existingMember = await tx.query.listMembers.findFirst({
      where: and(
        eq(listMembers.listId, inviteRow.list_id),
        eq(listMembers.userId, callerId),
      ),
    });

    let memberRow: typeof listMembers.$inferSelect;
    if (existingMember) {
      memberRow = existingMember;
    } else {
      const [created] = await tx
        .insert(listMembers)
        .values({
          listId: inviteRow.list_id,
          userId: callerId,
          role: inviteRow.role,
          invitedBy: inviteRow.invited_by,
        })
        .returning();
      if (!created) {
        throw new Error("acceptInvite: insert list_members returned no row");
      }
      memberRow = created;
    }

    await tx
      .update(listInvites)
      .set({
        acceptedAt: now,
        acceptedByUserId: callerId,
      })
      .where(eq(listInvites.id, inviteRow.id));

    if (!existingMember) {
      // Phase 4 · P2-6: build snapshot directly from the consolidated
      // `caller` row above — no second SELECT.
      const snapshot: MemberSnapshot = {
        id: memberRow.id,
        listId: memberRow.listId,
        userId: memberRow.userId,
        role: memberRow.role as ListRole,
        invitedBy: memberRow.invitedBy,
        acceptedAt: memberRow.acceptedAt.toISOString(),
        createdAt: memberRow.createdAt.toISOString(),
        updatedAt: memberRow.updatedAt.toISOString(),
        user: {
          telegramFirstName: caller.telegramFirstName,
          telegramUsername: caller.telegramUsername,
          telegramPhotoUrl: caller.telegramPhotoUrl,
        },
      };

      await tx.insert(activityLog).values({
        listId: memberRow.listId,
        entityType: "member",
        entityId: memberRow.id,
        action: "member_added",
        actorId: callerId,
        payloadBefore: null,
        payloadAfter: snapshot,
      });
    }

    return {
      ok: true,
      listId: memberRow.listId,
      alreadyAccepted: !!existingMember,
    };
  });
}
