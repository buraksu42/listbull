/**
 * `POST /api/lists/[id]/invite` request body validator. The HTTP body
 * shape mirrors `share_list`'s LLM input but uses HTTP-conventional
 * camelCase. The route handler translates to the executor's snake_case
 * input shape so both surfaces share one write path.
 *
 * Phase 4 · P2-2: typed response shapes are co-located here so the
 * Frontend imports them directly (no inline declarations / drift).
 */
import { z } from "zod";

import type { InviteTokenInfo } from "@/lib/types";

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

/**
 * Response shape of `GET /api/invites/[token]`. The token's 256-bit
 * entropy is the auth surface (Inv-10) — no session is required to
 * read invite metadata. `currentUserCanAccept` is `true` only when an
 * authenticated session matches the invite's `invited_username`.
 */
export type InviteTokenResponse = {
  invite: InviteTokenInfo;
  currentUserCanAccept: boolean;
};

/**
 * Response shape of `POST /api/invites/[token]/accept`. `alreadyAccepted`
 * is `true` for idempotent re-acceptances (e.g. parallel accept landed
 * first); the route handler returns 200 either way so the client can
 * navigate to the list.
 */
export type AcceptInviteResponse = {
  listId: string;
  alreadyAccepted: boolean;
};
