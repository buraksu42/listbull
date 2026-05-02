/**
 * `POST /api/lists/[id]/invite` request body validator. The HTTP body
 * shape mirrors `share_list`'s LLM input but uses HTTP-conventional
 * camelCase. The route handler translates to the executor's snake_case
 * input shape so both surfaces share one write path.
 */
import { z } from "zod";

export const postInviteBodySchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, "username is required")
    .max(33, "username must be ≤32 chars (plus optional leading @)"),
  role: z.enum(["editor", "viewer"]).default("editor"),
});

export type PostInviteBody = z.infer<typeof postInviteBodySchema>;

export const patchMemberRoleBodySchema = z.object({
  role: z.enum(["editor", "viewer"]),
});

export type PatchMemberRoleBody = z.infer<typeof patchMemberRoleBodySchema>;
