-- Drop the Hetzner Object Storage mirror path for attachments.
--
-- The backup-attachments cron + object-storage.ts client + settings
-- export S3 dependency are all removed. listbull now stores
-- attachment references via `telegramFileId` only — files live on
-- Telegram CDN, Mini App preview via Bot API getFile (capped at
-- 20MB), and the "Telegram'a yolla" fallback handles everything
-- larger.
--
-- Self-host operators trade away the option of an off-Telegram
-- mirror for: zero managed-services dependency + no storage bills.

DROP INDEX IF EXISTS "item_attachments_unbacked_idx";

ALTER TABLE "item_attachments" DROP COLUMN IF EXISTS "storage_key";
ALTER TABLE "item_attachments" DROP COLUMN IF EXISTS "storage_backed_up_at";
