/**
 * Executor: `create_list`.
 *
 * Inserts one row into `lists`, one `list_members` row (caller becomes
 * owner per Inv-2), and one `activity_log` `list_created` row in a
 * single transaction (Inv-1). The Inbox list is created via /start and
 * is_inbox=true is rejected here — callers cannot create a second Inbox.
 */
import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  activityLog,
  listMembers,
  lists,
  workspaces,
} from "@/lib/db/schema";
import {
  createListInputSchema,
  type CreateListOutput,
} from "@/lib/ai/tools";
import { ERR, err, ok } from "./_shared";
import { toListSnapshot } from "@/lib/db/snapshots";

import type { ExecResult } from "./_shared";

export async function executeCreateList(
  input: unknown,
  ctx: { userId: string; workspaceId: string },
): Promise<ExecResult<CreateListOutput>> {
  const parsed = createListInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const { name, emoji, is_checklist, visibility } = parsed.data;

  // Default emoji if neither user nor LLM supplied one. Avoids "naked"
  // list names in the bot's reply that look out-of-place next to other
  // lists with emojis. Pass `emoji: null` explicitly to opt out (LLM
  // shouldn't, but the schema allows it). For checklists, default to
  // ☑️ so the list visibly reads as a control surface.
  const finalEmoji =
    emoji === undefined ? (is_checklist ? "☑️" : "📋") : emoji;

  return await db.transaction(async (tx) => {
    // Visibility resolution (Phase 16/#28):
    //   1. caller-supplied input wins
    //   2. else inherit workspaces.default_list_visibility
    let finalVisibility: "public" | "private" = visibility ?? "private";
    if (!visibility) {
      const [ws] = await tx
        .select({
          defaultListVisibility: workspaces.defaultListVisibility,
        })
        .from(workspaces)
        .where(eq(workspaces.id, ctx.workspaceId))
        .limit(1);
      if (ws?.defaultListVisibility === "public") finalVisibility = "public";
    }

    const [created] = await tx
      .insert(lists)
      .values({
        name,
        emoji: finalEmoji,
        ownerId: ctx.userId,
        workspaceId: ctx.workspaceId,
        isInbox: false,
        isChecklist: is_checklist ?? false,
        visibility: finalVisibility,
      })
      .returning();
    if (!created) throw new Error("create-list: insert returned no row");

    await tx.insert(listMembers).values({
      listId: created.id,
      userId: ctx.userId,
      role: "owner",
    });

    await tx.insert(activityLog).values({
      listId: created.id,
      entityType: "list",
      entityId: created.id,
      action: "list_created",
      actorId: ctx.userId,
      payloadBefore: null,
      payloadAfter: toListSnapshot(created),
    });

    return ok({
      list: {
        id: created.id,
        name: created.name,
        emoji: created.emoji,
        is_checklist: created.isChecklist,
        visibility: finalVisibility,
      },
    });
  });
}
