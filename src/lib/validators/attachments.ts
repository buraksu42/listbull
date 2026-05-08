/**
 * Mini App attachments API validators (Phase 14b).
 *
 * The HTTP surface lets clients enumerate attachments per item,
 * stream/redirect to the resolved bytes, and DELETE individual
 * attachments. The bot intake path (telegram → attach_file_to_item
 * tool) does NOT consume these schemas; AI tool input has its own
 * snake_case schema in `ai/tools.ts`.
 */
import { z } from "zod";

export const ATTACHMENT_KINDS = [
  "photo",
  "video",
  "document",
  "audio",
  "voice",
  "video_note",
] as const;

export type AttachmentKindLiteral = (typeof ATTACHMENT_KINDS)[number];

/**
 * Path params for `/api/attachments/[itemId]/[attachmentId]`.
 *
 * Both ids must be valid UUIDs; the route handler verifies that the
 * attachment row's `item_id` actually equals the path's `itemId` so a
 * malicious caller can't probe arbitrary attachment ids by guessing.
 */
export const attachmentParamsSchema = z.object({
  itemId: z.string().uuid(),
  attachmentId: z.string().uuid(),
});

export const itemAttachmentsListParamsSchema = z.object({
  itemId: z.string().uuid(),
});
