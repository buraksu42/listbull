/**
 * Executor: `set_workspace_api_key` (Phase 16).
 *
 * Owner-only. Persists the calling user's pasted OpenRouter API key
 * onto `workspaces.openrouter_api_key_encrypted` (AES-256-GCM via
 * ENV_KEY). Telegram-side hygiene (raw-key redaction in messages
 * table + deleteMessage of the user's pasted message) lives in
 * handle-message.ts so this executor stays portable.
 */
import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { activityLog, workspaceMembers, workspaces } from "@/lib/db/schema";
import {
  setWorkspaceApiKeyInputSchema,
  type SetWorkspaceApiKeyOutput,
} from "@/lib/ai/tools";
import { encrypt } from "@/lib/server/encryption";
import { ERR, err, ok } from "./_shared";

import type { ExecResult } from "./_shared";

export async function executeSetWorkspaceApiKey(
  input: unknown,
  ctx: { userId: string; workspaceId: string },
): Promise<ExecResult<SetWorkspaceApiKeyOutput>> {
  const parsed = setWorkspaceApiKeyInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }

  // Owner-only mutation.
  const member = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, ctx.workspaceId),
      eq(workspaceMembers.userId, ctx.userId),
    ),
  });
  if (!member) {
    return err(ERR.not_found, "Workspace not found.");
  }
  if (member.role !== "owner") {
    return err(
      ERR.forbidden,
      "Only the workspace owner can set the OpenRouter API key.",
    );
  }

  const cipher = encrypt(parsed.data.api_key);
  const suffix = parsed.data.api_key.slice(-4);

  return await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(workspaces)
      .set({
        openrouterApiKeyEncrypted: cipher,
        updatedAt: new Date(),
      })
      .where(eq(workspaces.id, ctx.workspaceId))
      .returning({
        id: workspaces.id,
        name: workspaces.name,
      });
    if (!updated) {
      throw new Error("set-workspace-api-key: update returned no row");
    }

    await tx.insert(activityLog).values({
      listId: null,
      entityType: "workspace",
      entityId: updated.id,
      action: "workspace_renamed", // re-using the shell-mutation enum (Phase 16/#28)
      actorId: ctx.userId,
      payloadBefore: { api_key_set: false },
      payloadAfter: { api_key_set: true, key_suffix: suffix },
    });

    return ok({
      workspace: { id: updated.id, name: updated.name },
      key_suffix: suffix,
    });
  });
}
