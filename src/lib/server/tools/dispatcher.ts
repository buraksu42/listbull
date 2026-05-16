/**
 * Tool dispatcher (Phase 17 chat-only).
 *
 * Routes a `ToolCall` from `respond.ts` to the right executor. Every
 * tool failure travels back as `output` envelopes — throwing is
 * reserved for unrecoverable infra issues which `respond.ts`'s
 * `safeDispatch` catches.
 *
 * ExecutorCtx now carries `chatId` (BIGINT Telegram chat_id) instead
 * of `workspaceId`. Chat resolution happens in `handle-message`.
 */
import "server-only";

import type { ToolCall, ToolResult } from "@/lib/types";
import type { ToolDispatcher } from "@/lib/ai/types";
import type { ToolName } from "@/lib/ai/tools";

import { executeAddReminder } from "./add-reminder";
import { executeAssignItem } from "./assign-item";
import { executeAttachFileToItem } from "./attach-file-to-item";
import { executeCompleteChecklistRun } from "./complete-checklist-run";
import { executeCompleteItem } from "./complete-item";
import { executeCreateItem } from "./create-item";
import { executeDeleteItem } from "./delete-item";
import { executeGetItemByPosition } from "./get-item-by-position";
import { executeListChatMembers } from "./list-chat-members";
import { executeRemoveReminder } from "./remove-reminder";
import { executeSearchItems } from "./search-items";
import { executeSetChatApiKey } from "./set-chat-api-key";
import { executeSetDeadline } from "./set-deadline";
import { executeSetItemAttributes } from "./set-item-attributes";
import { executeStartChecklistRun } from "./start-checklist-run";
import { executeUpdateItem } from "./update-item";
import { executeUpdateSettings } from "./update-settings";
import { ERR } from "./_shared";

export type ExecutorCtx = {
  userId: string;
  chatId: number;
};

export function createToolDispatcher(ctx: ExecutorCtx): ToolDispatcher {
  return async function dispatch(call: ToolCall): Promise<ToolResult> {
    const { id, name, input } = call;
    // Arg VALUES not logged so user-content stays out of logs.
    const argKeys =
      input && typeof input === "object" && !Array.isArray(input)
        ? Object.keys(input as Record<string, unknown>)
        : [];
    // Pre-call breadcrumb: fires even if the executor throws so we
    // never lose track of which tool was being attempted.
    console.log("[tool:start]", { name, args: argKeys, chatId: ctx.chatId });
    try {
      const output = await routeCall(name as ToolName, input, ctx);
      const result = output as { ok?: boolean; error?: { code?: string } };
      console.log("[tool:done]", {
        name,
        chatId: ctx.chatId,
        ok: result?.ok ?? null,
        errCode: result?.error?.code ?? null,
      });
      return { toolCallId: id, output };
    } catch (err) {
      console.error("[tool:throw]", {
        name,
        chatId: ctx.chatId,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack?.slice(0, 800) : undefined,
      });
      throw err;
    }
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
    case "set_deadline":
      return await executeSetDeadline(input, ctx);
    case "add_reminder":
      return await executeAddReminder(input, ctx);
    case "remove_reminder":
      return await executeRemoveReminder(input, ctx);
    case "assign_item":
      return await executeAssignItem(input, ctx);
    case "set_item_attributes":
      return await executeSetItemAttributes(input, ctx);
    case "update_settings":
      return await executeUpdateSettings(input, ctx);
    case "attach_file_to_item":
      return await executeAttachFileToItem(input, ctx);
    case "start_checklist_run":
      return await executeStartChecklistRun(input, ctx);
    case "complete_checklist_run":
      return await executeCompleteChecklistRun(input, ctx);
    case "set_chat_api_key":
      return await executeSetChatApiKey(input, ctx);
    case "list_chat_members":
      return await executeListChatMembers(input, ctx);
    case "get_item_by_position":
      return await executeGetItemByPosition(input, ctx);
    default:
      return {
        ok: false,
        error: {
          code: ERR.bad_input,
          message: buildUnknownToolMessage(name as string),
        },
      };
  }
}

const KNOWN_TOOLS = [
  "create_item",
  "search_items",
  "update_item",
  "complete_item",
  "delete_item",
  "set_deadline",
  "add_reminder",
  "remove_reminder",
  "assign_item",
  "set_item_attributes",
  "update_settings",
  "attach_file_to_item",
  "start_checklist_run",
  "complete_checklist_run",
  "set_chat_api_key",
  "list_chat_members",
  "get_item_by_position",
] as const;

function buildUnknownToolMessage(badName: string): string {
  const suggestion = closestTool(badName);
  if (suggestion) {
    return `Unknown tool: ${badName}. Did you mean: ${suggestion}? Retry with the correct name.`;
  }
  return `Unknown tool: ${badName}. Valid tools: ${KNOWN_TOOLS.join(", ")}.`;
}

function closestTool(name: string): string | null {
  let best: { tool: string; dist: number } | null = null;
  for (const tool of KNOWN_TOOLS) {
    const dist = levenshtein(name.toLowerCase(), tool);
    if (!best || dist < best.dist) {
      best = { tool, dist };
    }
  }
  if (!best || best.dist > 4) return null;
  return best.tool;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev: number[] = new Array(b.length + 1).fill(0).map((_, i) => i);
  const curr: number[] = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (curr[j - 1] ?? 0) + 1,
        (prev[j] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j] ?? 0;
  }
  return prev[b.length] ?? 0;
}
