/**
 * Executor: `list_chat_members` (Phase 17).
 *
 * Read-only enumeration. Used by the assignee picker.
 */
import "server-only";

import { listChatMembers } from "@/lib/db/queries/chats";
import { type ListChatMembersOutput } from "@/lib/ai/tools";
import { ok } from "./_shared";
import type { ExecResult } from "./_shared";

export async function executeListChatMembers(
  _input: unknown,
  ctx: { userId: string; chatId: number },
): Promise<ExecResult<ListChatMembersOutput>> {
  const members = await listChatMembers(ctx.chatId);
  return ok({
    members: members.map((m) => ({
      user_id: m.userId,
      telegram_username: m.telegramUsername,
      telegram_first_name: m.telegramFirstName,
      joined_at: m.joinedAt.toISOString(),
    })),
  });
}
