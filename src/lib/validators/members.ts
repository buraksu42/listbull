/**
 * Members API typed response shapes (Phase 4 · P2-2).
 *
 * The Frontend (`src/components/lists/member-list.tsx`) used to declare
 * `MemberRow` inline; Phase 4 hoists every wire shape into validators so
 * Backend is the single source of truth. Re-exports from the query layer
 * (`MemberWithUser`) where the canonical row shape lives.
 */
import type { MemberWithUser } from "@/lib/db/queries/members";
import type { MemberSnapshot } from "@/lib/types";

/** Canonical row shape returned by `GET /api/lists/[id]/members`. */
export type MemberRow = MemberWithUser;

/** Response shape of `GET /api/lists/[id]/members`. */
export type MembersListResponse = {
  members: MemberRow[];
};

/** Response shape of `DELETE /api/lists/[id]/members/[memberId]`. */
export type RemoveMemberResponse = {
  /** Number of items where `assignee_id` was cleared as a side-effect (Inv-12). */
  removedItemCount: number;
};

/** Response shape of `PATCH /api/lists/[id]/members/[memberId]`. */
export type UpdateMemberRoleResponse = {
  member: MemberSnapshot;
};
