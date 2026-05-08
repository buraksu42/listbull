/**
 * Executor: `create_workspace` — mirror of `POST /api/workspaces`.
 *
 * Same shape as the Mini App route: tier middleware first, then the
 * `workspaces` + `workspaceMembers (role=owner)` insert in a single
 * transaction. Returns `tier_exceeded` when the caller's tier blocks
 * a new workspace; the LLM is expected to surface the upgrade hint.
 */
import "server-only";

import { db } from "@/lib/db/client";
import { workspaceMembers, workspaces } from "@/lib/db/schema";
import {
  createWorkspaceInputSchema,
  type CreateWorkspaceOutput,
} from "@/lib/ai/tools";
import { TIER_LIMITS, type WorkspaceTier } from "@/lib/types";
import { ERR, err, ok } from "./_shared";
import { slugify } from "@/lib/db/queries/workspaces";
import { enforceTier } from "@/lib/server/middleware/tier-enforce";

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

  // Tier check — workspace creation may be limited on the caller's plan.
  const tierResult = await enforceTier("", { type: "create_workspace" });
  if (tierResult.enforced) {
    return err(
      "tier_exceeded",
      tierResult.message ?? "Workspace creation requires an upgrade.",
    );
  }

  const tier: WorkspaceTier = "free";
  const slug = slugify(name) || `ws-${ctx.userId.slice(0, 8)}`;

  const created = await db.transaction(async (tx) => {
    const [w] = await tx
      .insert(workspaces)
      .values({
        name,
        slug,
        tier,
        isPersonal: false,
        ownerId: ctx.userId,
        memberLimit: TIER_LIMITS[tier].memberLimit,
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
      tier: created.tier as "free" | "team" | "workspace",
      is_personal: created.isPersonal,
    },
  });
}
