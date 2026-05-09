/**
 * Executor: `create_workspace` — mirror of `POST /api/workspaces`.
 *
 * Single-tier model post-billing-tear-out: any user can create as
 * many workspaces as they want. Inserts the `workspaces` row +
 * `workspaceMembers (role=owner)` row in a single transaction.
 */
import "server-only";

import { db } from "@/lib/db/client";
import { workspaceMembers, workspaces } from "@/lib/db/schema";
import {
  createWorkspaceInputSchema,
  type CreateWorkspaceOutput,
} from "@/lib/ai/tools";
import { ERR, err, ok } from "./_shared";
import { slugify } from "@/lib/db/queries/workspaces";

import type { ExecResult } from "./_shared";

export async function executeCreateWorkspace(
  input: unknown,
  ctx: { userId: string; workspaceId: string },
): Promise<ExecResult<CreateWorkspaceOutput>> {
  const parsed = createWorkspaceInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const name = parsed.data.name.trim().slice(0, 120);
  const slug = slugify(name) || `ws-${ctx.userId.slice(0, 8)}`;

  const created = await db.transaction(async (tx) => {
    const [w] = await tx
      .insert(workspaces)
      .values({
        name,
        slug,
        isPersonal: false,
        ownerId: ctx.userId,
      })
      .returning();
    if (!w) throw new Error("create-workspace: insert returned no row");

    await tx.insert(workspaceMembers).values({
      workspaceId: w.id,
      userId: ctx.userId,
      role: "owner",
    });

    return w;
  });

  return ok({
    workspace: {
      id: created.id,
      name: created.name,
      slug: created.slug,
      is_personal: created.isPersonal,
    },
  });
}
