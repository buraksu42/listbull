/**
 * Executor: `update_workspace` — owner-only rename of the active
 * workspace. Re-slugs from the new name; tier stays untouched
 * (changes to tier flow through Billing-agent's webhook handlers).
 *
 * Writes one `workspace_renamed` activity_log row (Inv-1).
 */
import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  activityLog,
  workspaceMembers,
  workspaces,
} from "@/lib/db/schema";
import {
  updateWorkspaceInputSchema,
  type UpdateWorkspaceOutput,
} from "@/lib/ai/tools";
import { slugify } from "@/lib/db/queries/workspaces";
import { ERR, err, ok } from "./_shared";

import type { ExecResult } from "./_shared";

export async function executeUpdateWorkspace(
  input: unknown,
  ctx: { userId: string; workspaceId: string },
): Promise<ExecResult<UpdateWorkspaceOutput>> {
  const parsed = updateWorkspaceInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(ERR.invalid_input, parsed.error.message);
  }
  const { workspace_id, name, default_list_visibility } = parsed.data;
  const targetId = workspace_id ?? ctx.workspaceId;

  // Owner gate: only the workspace's owner can mutate it.
  const member = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, targetId),
      eq(workspaceMembers.userId, ctx.userId),
    ),
  });
  if (!member) {
    return err(ERR.not_found, "Workspace not found.");
  }
  if (member.role !== "owner") {
    return err(ERR.forbidden, "Only the workspace owner can update it.");
  }

  return await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, targetId))
      .limit(1);
    if (!current) return err(ERR.not_found, "Workspace not found.");

    const trimmedName = name?.trim();
    const changes: Array<"name" | "default_list_visibility"> = [];
    const patch: Partial<typeof workspaces.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (trimmedName !== undefined && trimmedName !== current.name) {
      patch.name = trimmedName;
      patch.slug = current.isPersonal
        ? current.slug
        : await ensureUniqueSlug(slugify(trimmedName), current.id);
      changes.push("name");
    }
    if (
      default_list_visibility !== undefined &&
      default_list_visibility !== current.defaultListVisibility
    ) {
      patch.defaultListVisibility = default_list_visibility;
      changes.push("default_list_visibility");
    }

    if (changes.length === 0) {
      return ok({
        workspace: {
          id: current.id,
          name: current.name,
          slug: current.slug,
          default_list_visibility: current.defaultListVisibility as
            | "public"
            | "private",
        },
        changes: [],
      });
    }

    const [updated] = await tx
      .update(workspaces)
      .set(patch)
      .where(eq(workspaces.id, targetId))
      .returning();
    if (!updated) throw new Error("update-workspace: update returned no row");

    // Activity log row. We re-use 'workspace_renamed' for any
    // workspace-shell mutation — the audit feed picks it up regardless.
    await tx.insert(activityLog).values({
      listId: null,
      entityType: "workspace",
      entityId: updated.id,
      action: "workspace_renamed",
      actorId: ctx.userId,
      payloadBefore: {
        id: current.id,
        name: current.name,
        slug: current.slug,
        default_list_visibility: current.defaultListVisibility,
      },
      payloadAfter: {
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        default_list_visibility: updated.defaultListVisibility,
      },
    });

    return ok({
      workspace: {
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        default_list_visibility: updated.defaultListVisibility as
          | "public"
          | "private",
      },
      changes,
    });
  });
}

/**
 * Slug uniqueness: append `-2`, `-3`, ... on collision.
 * `excludeId` is the row being renamed (its current slug doesn't
 * count as a collision).
 */
async function ensureUniqueSlug(
  base: string,
  excludeId: string,
): Promise<string> {
  let attempt = base;
  let suffix = 2;
  while (true) {
    const collision = await db.query.workspaces.findFirst({
      where: and(eq(workspaces.slug, attempt)),
      columns: { id: true },
    });
    if (!collision || collision.id === excludeId) return attempt;
    attempt = `${base}-${suffix}`;
    suffix += 1;
    if (suffix > 100) {
      // Defensive: 100 collisions on the same slug is pathological.
      throw new Error(
        `ensureUniqueSlug: too many collisions for ${base}`,
      );
    }
  }
}
