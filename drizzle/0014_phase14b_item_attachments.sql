-- Phase 14b: hybrid Telegram file_id + Hetzner Object Storage backup.
--
-- Additive only — no existing rows are touched. The backup-attachments
-- cron consumes the partial index `item_attachments_backup_queue_idx`
-- to discover unbacked rows.
CREATE TABLE "item_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"telegram_file_id" text NOT NULL,
	"telegram_file_unique_id" text,
	"mime_type" text,
	"file_size" bigint,
	"duration_seconds" integer,
	"width" integer,
	"height" integer,
	"thumbnail_file_id" text,
	"original_filename" text,
	"storage_key" text,
	"storage_backed_up_at" timestamp with time zone,
	"uploaded_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "item_attachments" ADD CONSTRAINT "item_attachments_item_id_items_id_fk"
	FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "item_attachments" ADD CONSTRAINT "item_attachments_workspace_id_workspaces_id_fk"
	FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "item_attachments" ADD CONSTRAINT "item_attachments_uploaded_by_user_id_users_id_fk"
	FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "item_attachments_item_idx"
	ON "item_attachments" USING btree ("item_id");
--> statement-breakpoint
CREATE INDEX "item_attachments_backup_queue_idx"
	ON "item_attachments" USING btree ("created_at")
	WHERE "item_attachments"."storage_backed_up_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "item_attachments_telegram_unique_idx"
	ON "item_attachments" USING btree ("item_id", "telegram_file_unique_id")
	WHERE "item_attachments"."telegram_file_unique_id" IS NOT NULL;
