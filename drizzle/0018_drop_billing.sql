-- Billing / tier / license tear-out.
--
-- listbull settled on a single self-host operator + invited users
-- model. Multi-tier pricing, Stripe / Iyzico checkout, license
-- issuance, per-member spend caps, and llm_usage telemetry are all
-- removed.
--
-- Forward-only — no down migration. Re-issuing tiers / billing later
-- would require a fresh design rather than re-applying these tables.
--
-- Order: drop FK-bearing tables first, then remove columns from
-- workspaces (which the dropped tables referenced).

DROP TABLE IF EXISTS "workspace_member_caps";
DROP TABLE IF EXISTS "llm_usage";
DROP TABLE IF EXISTS "subscriptions";
DROP TABLE IF EXISTS "billing_customers";
DROP TABLE IF EXISTS "licenses";

ALTER TABLE "workspaces" DROP COLUMN IF EXISTS "tier";
ALTER TABLE "workspaces" DROP COLUMN IF EXISTS "member_limit";
