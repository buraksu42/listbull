-- Phase 16 (checklists): repeatable process lists.
--
-- Additive — no existing rows are touched. is_checklist defaults to
-- false, so every existing list keeps behaving as before. The
-- list_runs table is empty until the first `start_checklist_run`
-- invocation.
ALTER TABLE "lists"
	ADD COLUMN "is_checklist" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE "list_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"started_by_user_id" uuid NOT NULL,
	"completed_by_user_id" uuid,
	"items_total" integer DEFAULT 0 NOT NULL,
	"items_completed" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "list_runs" ADD CONSTRAINT "list_runs_list_id_lists_id_fk"
	FOREIGN KEY ("list_id") REFERENCES "lists"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "list_runs" ADD CONSTRAINT "list_runs_started_by_user_id_users_id_fk"
	FOREIGN KEY ("started_by_user_id") REFERENCES "users"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "list_runs" ADD CONSTRAINT "list_runs_completed_by_user_id_users_id_fk"
	FOREIGN KEY ("completed_by_user_id") REFERENCES "users"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX "list_runs_list_recent_idx"
	ON "list_runs" USING btree ("list_id", "started_at" DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX "list_runs_active_per_list_uq"
	ON "list_runs" USING btree ("list_id")
	WHERE "list_runs"."completed_at" IS NULL;
