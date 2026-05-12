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
import { executeCreateSnapshot } from "./create-snapshot";
import { executeCancelInvite } from "./cancel-invite";
import { executeListMembers } from "./list-members";
import { executeRemoveMember } from "./remove-member";
import { executeUpdateMemberRole } from "./update-member-role";
import { executeUpdateSettings } from "./update-settings";
import { executeSetDeadline } from "./set-deadline";
import { executeAddReminder } from "./add-reminder";
import { executeRemoveReminder } from "./remove-reminder";
import { executeAttachFileToItem } from "./attach-file-to-item";
import { executeStartChecklistRun } from "./start-checklist-run";
import { executeCompleteChecklistRun } from "./complete-checklist-run";
import { executeAssignItem } from "./assign-item";
import { executeCreateWorkspace } from "./create-workspace";
import { executeSwitchWorkspace } from "./switch-workspace";
import { executeListWorkspaces } from "./list-workspaces";
import { executeUpdateWorkspace } from "./update-workspace";
import { executeInviteToWorkspace } from "./invite-to-workspace";
import { executeRemoveWorkspaceMember } from "./remove-workspace-member";
import { executeListWorkspaceInvites } from "./list-workspace-invites";
import { executeCancelWorkspaceInvite } from "./cancel-workspace-invite";
import { executeSetItemAttributes } from "./set-item-attributes";
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
    case "create_snapshot":
      return await executeCreateSnapshot(input, ctx);
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
    case "set_deadline":
      return await executeSetDeadline(input, ctx);
    case "add_reminder":
      return await executeAddReminder(input, ctx);
    case "remove_reminder":
      return await executeRemoveReminder(input, ctx);
    case "attach_file_to_item":
      return await executeAttachFileToItem(input, ctx);
    case "start_checklist_run":
      return await executeStartChecklistRun(input, ctx);
    case "complete_checklist_run":
      return await executeCompleteChecklistRun(input, ctx);
    case "assign_item":
      return await executeAssignItem(input, ctx);
    case "create_workspace":
      return await executeCreateWorkspace(input, ctx);
    case "switch_workspace":
      return await executeSwitchWorkspace(input, ctx);
    case "list_workspaces":
      return await executeListWorkspaces(input, ctx);
    case "update_workspace":
      return await executeUpdateWorkspace(input, ctx);
    case "invite_to_workspace":
      return await executeInviteToWorkspace(input, ctx);
    case "remove_workspace_member":
      return await executeRemoveWorkspaceMember(input, ctx);
    case "list_workspace_invites":
      return await executeListWorkspaceInvites(input, ctx);
    case "cancel_workspace_invite":
      return await executeCancelWorkspaceInvite(input, ctx);
    case "set_item_attributes":
      return await executeSetItemAttributes(input, ctx);
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
