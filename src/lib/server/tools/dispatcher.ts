/**
 * Tool dispatcher: routes a `ToolCall` from `respond.ts` to the right
 * executor for the given user context.
 *
 * The dispatcher MUST return successfully — even tool failures travel
 * back as `output` envelopes so the LLM can recover. Throwing is
 * reserved for unrecoverable infra issues; `respond.ts`'s `safeDispatch`
 * catches those and converts them to internal_error envelopes.
 */
import "server-only";

import type { ToolCall, ToolResult } from "@/lib/types";
import type { ToolDispatcher } from "@/lib/ai/types";
import type { ToolName } from "@/lib/ai/tools";

import { executeCreateItem } from "./create-item";
import { executeSearchItems } from "./search-items";
import { executeUpdateItem } from "./update-item";
import { executeCompleteItem } from "./complete-item";
import { executeDeleteItem } from "./delete-item";
import { executeListLists } from "./list-lists";
import { executeCreateList } from "./create-list";
import { executeUpdateList } from "./update-list";
import { executeDeleteList } from "./delete-list";
import { executeRestoreList } from "./restore-list";
import { executeShareList } from "./share-list";
import { executeCancelInvite } from "./cancel-invite";
import { executeListMembers } from "./list-members";
import { executeRemoveMember } from "./remove-member";
import { executeUpdateMemberRole } from "./update-member-role";
import { executeUpdateSettings } from "./update-settings";
import { executeScheduleReminder } from "./schedule-reminder";
import { executeAssignItem } from "./assign-item";
import { ERR } from "./_shared";

/**
 * Per-tool execution context. `workspaceId` is the user's currently-
 * active workspace, resolved by the dispatcher caller (handle-message
 * for bot, route handler for Mini App) before each LLM turn.
 *
 * Phase 4.5: every executor reads `workspaceId` to scope queries.
 * Phase 5 adds bot-aware overlay (incoming bot ID → bound workspace
 * → ctx.workspaceId override).
 */
export type ExecutorCtx = {
  userId: string;
  workspaceId: string;
};

/**
 * Build a per-user dispatcher. Backend's bot router calls this once per
 * Telegram update and passes the dispatcher into `respond()`.
 */
export function createToolDispatcher(ctx: ExecutorCtx): ToolDispatcher {
  return async function dispatch(call: ToolCall): Promise<ToolResult> {
    const { id, name, input } = call;
    const output = await routeCall(name as ToolName, input, ctx);
    return { toolCallId: id, output };
  };
}

async function routeCall(
  name: ToolName | string,
  input: unknown,
  ctx: ExecutorCtx,
): Promise<unknown> {
  switch (name) {
    case "create_item":
      return await executeCreateItem(input, ctx);
    case "search_items":
      return await executeSearchItems(input, ctx);
    case "update_item":
      return await executeUpdateItem(input, ctx);
    case "complete_item":
      return await executeCompleteItem(input, ctx);
    case "delete_item":
      return await executeDeleteItem(input, ctx);
    case "list_lists":
      return await executeListLists(input, ctx);
    case "create_list":
      return await executeCreateList(input, ctx);
    case "update_list":
      return await executeUpdateList(input, ctx);
    case "delete_list":
      return await executeDeleteList(input, ctx);
    case "restore_list":
      return await executeRestoreList(input, ctx);
    case "share_list":
      return await executeShareList(input, ctx);
    case "cancel_invite":
      return await executeCancelInvite(input, ctx);
    case "list_members":
      return await executeListMembers(input, ctx);
    case "remove_member":
      return await executeRemoveMember(input, ctx);
    case "update_member_role":
      return await executeUpdateMemberRole(input, ctx);
    case "update_settings":
      return await executeUpdateSettings(input, ctx);
    case "schedule_reminder":
      return await executeScheduleReminder(input, ctx);
    case "assign_item":
      return await executeAssignItem(input, ctx);
    default:
      return {
        ok: false,
        error: {
          code: ERR.bad_input,
          message: `Unknown tool: ${name}`,
        },
      };
  }
}
