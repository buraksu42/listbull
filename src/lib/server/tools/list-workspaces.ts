/**
 * Executor: `list_workspaces` — read-only enumeration. Wraps
 * `listWorkspacesForUser` (already implemented for the Mini App
 * switcher) and reshapes for the LLM-facing snake_case contract.
 */
import "server-only";

import {
  listWorkspacesInputSchema,
  type ListWorkspacesOutput,
} from "@/lib/ai/tools";
import { listWorkspacesForUser } from "@/lib/db/queries/workspaces";
import { ERR, err, ok } from "./_shared";

import type { ExecResult } from "./_shared";

export async function executeListWorkspaces(
  input: unknown,
  ctx: { userId: string; workspaceId: string },
): Promise<ExecResult<ListWorkspacesOutput>> {
  const parsed = listWorkspacesInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }

  const rows = await listWorkspacesForUser(ctx.userId);

  return ok({
    workspaces: rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      is_personal: r.isPersonal,
      role: r.role,
      member_count: r.memberCount,
      list_count: r.listCount,
      is_active: r.isActive,
    })),
  });
}
