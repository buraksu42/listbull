-- Phase 14d: split deadline from reminder.
--
-- 1. Create item_reminders child table (1-to-N).
-- 2. Backfill: every item with due_at != null becomes one absolute
--    reminder at the same time, carrying over recurrence_rule and
--    reminder_sent.
-- 3. Drop legacy items columns + index, rename due_at → deadline_at.
--
-- Deploy order: stop cron container → run migration → deploy code →
-- start cron. Cron downtime ~60s.

CREATE TABLE "item_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"remind_at" timestamp with time zone NOT NULL,
	"kind" text DEFAULT 'absolute' NOT NULL,
	"offset_minutes" integer,
	"recurrence_rule" text,
	"sent" boolean DEFAULT false NOT NULL,
	"last_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_reminders_kind_chk"
		CHECK ("kind" IN ('absolute', 'before_deadline')),
	CONSTRAINT "item_reminders_offset_pairing_chk"
		CHECK (
			("kind" = 'before_deadline' AND "offset_minutes" IS NOT NULL AND "offset_minutes" >= 0)
			OR ("kind" = 'absolute' AND "offset_minutes" IS NULL)
		),
	CONSTRAINT "item_reminders_recurrence_kind_chk"
		CHECK ("recurrence_rule" IS NULL OR "kind" = 'absolute')
);
--> statement-breakpoint
ALTER TABLE "item_reminders" ADD CONSTRAINT "item_reminders_item_id_items_id_fk"
	FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "item_reminders_due_idx"
	ON "item_reminders" USING btree ("remind_at")
	WHERE "item_reminders"."sent" = false;
--> statement-breakpoint
CREATE INDEX "item_reminders_item_idx"
	ON "item_reminders" USING btree ("item_id");
--> statement-breakpoint
-- Backfill: every active item with a non-null due_at gets one absolute
-- reminder mirroring its prior state.
INSERT INTO "item_reminders" (
	"id", "item_id", "remind_at", "kind", "offset_minutes",
	"recurrence_rule", "sent", "last_sent_at", "created_at", "updated_at"
)
SELECT
	gen_random_uuid(),
	"items"."id",
	"items"."due_at",
	'absolute',
	NULL,
	"items"."recurrence_rule",
	"items"."reminder_sent",
	CASE WHEN "items"."reminder_sent" = true THEN "items"."updated_at" ELSE NULL END,
	now(),
	now()
FROM "items"
WHERE "items"."due_at" IS NOT NULL
	AND "items"."archived_at" IS NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "items_due_at_idx";
--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "reminder_sent";
--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "recurrence_rule";
--> statement-breakpoint
ALTER TABLE "items" RENAME COLUMN "due_at" TO "deadline_at";
--> statement-breakpoint
CREATE INDEX "items_deadline_at_idx"
	ON "items" USING btree ("deadline_at")
	WHERE "items"."deadline_at" IS NOT NULL AND "items"."archived_at" IS NULL;
