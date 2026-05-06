CREATE TABLE "licenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"tier" text NOT NULL,
	"seats" integer NOT NULL,
	"issued_to_email" text NOT NULL,
	"workspaces" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"source_provider" text,
	"source_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "licenses_key_idx" ON "licenses" USING btree ("key");--> statement-breakpoint
CREATE INDEX "licenses_email_idx" ON "licenses" USING btree ("issued_to_email");--> statement-breakpoint
CREATE INDEX "licenses_revoked_idx" ON "licenses" USING btree ("revoked_at");