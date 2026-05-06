/**
 * Phase 4.5 data-migration script.
 *
 * Run AFTER `npm run db:migrate` applies `0001_nebulous_revanche.sql`
 * (which adds the workspace + billing + bot tables and a NULLABLE
 * `lists.workspace_id` column).
 *
 * What this script does (per docs/architecture-pass-phase-4.5.md
 * § "Migration runbook"):
 *
 *  1. Seed default platform bot in `bots` (token from env, encrypted).
 *  2. For every existing user: create Personal Workspace + insert
 *     workspace_members owner row + UPDATE users.active_workspace_id.
 *  3. Backfill `lists.workspace_id` from each list's owner's
 *     Personal Workspace.
 *  4. Seed `workspace_bots` for (every workspace, default_bot).
 *  5. Seed `bot_users` for (default_bot, every existing user).
 *  6. Backfill `items.status` from `is_done`.
 *  7. Finalize: ALTER lists.workspace_id SET NOT NULL + drop old
 *     `lists_owner_inbox_unique` + create
 *     `lists_workspace_inbox_unique`.
 *
 * Idempotent: re-running is a no-op once the data is in place. Each
 * step checks for the target row before inserting.
 *
 * Run command:
 *     npx tsx src/lib/server/migrations/workspace-pivot.ts
 *
 * Reverse: not automated. Restore from the hourly Postgres backup
 * (per global CLAUDE.md "Backup heartbeat").
 */
import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { encrypt } from "@/lib/server/encryption";
import { env } from "@/lib/env";

/**
 * Telegram bot tokens have the format `<bot_id>:<secret>`. The numeric
 * prefix is the bot's Telegram user ID — derivable without an API
 * call.
 */
function parseBotIdFromToken(token: string): number {
  const colonIdx = token.indexOf(":");
  if (colonIdx <= 0) {
    throw new Error(
      "Cannot parse bot ID from TELEGRAM_BOT_TOKEN — unexpected format",
    );
  }
  const idPart = token.slice(0, colonIdx);
  const id = Number(idPart);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("Cannot parse bot ID from TELEGRAM_BOT_TOKEN — not numeric");
  }
  return id;
}

async function seedDefaultBot(): Promise<string> {
  // Idempotent: if the default bot row already exists, return its id.
  const existing = await db.execute<{ id: string }>(
    sql`SELECT id FROM bots WHERE is_default = true LIMIT 1`,
  );
  if (existing[0]?.id) {
    console.log(
      `[workspace-pivot] default bot already seeded: ${existing[0].id}`,
    );
    return existing[0].id;
  }

  const botId = parseBotIdFromToken(env.TELEGRAM_BOT_TOKEN);
  const tokenCipher = encrypt(env.TELEGRAM_BOT_TOKEN);

  const inserted = await db.execute<{ id: string }>(sql`
    INSERT INTO bots (
      telegram_bot_id,
      telegram_bot_username,
      telegram_bot_token_encrypted,
      webhook_secret,
      is_default,
      created_by
    ) VALUES (
      ${botId},
      ${env.TELEGRAM_BOT_USERNAME},
      ${tokenCipher},
      ${env.TELEGRAM_WEBHOOK_SECRET},
      true,
      NULL
    )
    RETURNING id
  `);
  const id = inserted[0]?.id;
  if (!id) throw new Error("seedDefaultBot: insert returned no row");
  console.log(`[workspace-pivot] seeded default bot: ${id}`);
  return id;
}

async function seedPersonalWorkspaces(): Promise<void> {
  // Per-user Personal Workspace + owner membership row + active_workspace_id update,
  // for every user that doesn't already have one. Idempotent.
  const userRows = await db.execute<{ id: string }>(sql`
    SELECT u.id
    FROM users u
    LEFT JOIN workspaces w ON w.owner_id = u.id AND w.is_personal = true
    WHERE w.id IS NULL
  `);

  console.log(
    `[workspace-pivot] creating Personal Workspace for ${userRows.length} users`,
  );

  for (const u of userRows) {
    await db.transaction(async (tx) => {
      const created = await tx.execute<{ id: string }>(sql`
        INSERT INTO workspaces (name, slug, tier, is_personal, owner_id, member_limit)
        VALUES ('Personal', ${`${u.id}-personal`}, 'free', true, ${u.id}, 1)
        RETURNING id
      `);
      const wid = created[0]?.id;
      if (!wid) throw new Error("seedPersonalWorkspaces: insert returned no row");

      await tx.execute(sql`
        INSERT INTO workspace_members (workspace_id, user_id, role)
        VALUES (${wid}, ${u.id}, 'owner')
      `);

      await tx.execute(sql`
        UPDATE users SET active_workspace_id = ${wid} WHERE id = ${u.id}
      `);
    });
  }
}

async function backfillListsWorkspaceId(): Promise<void> {
  // Every list's workspace_id ← its owner's Personal Workspace.
  // Existing lists are owned by a single user; that user's Personal
  // Workspace is the natural home. Shared lists (where the user is a
  // member but not owner) still get their workspace_id from the
  // OWNER's Personal Workspace — those will need explicit move when
  // the original owner creates / shares an additional workspace
  // (Phase 5 UX).
  const result = await db.execute<{ updated: string }>(sql`
    WITH updated AS (
      UPDATE lists SET workspace_id = (
        SELECT id FROM workspaces
        WHERE owner_id = lists.owner_id AND is_personal = true
      )
      WHERE workspace_id IS NULL
      RETURNING id
    )
    SELECT COUNT(*)::text AS updated FROM updated
  `);
  console.log(
    `[workspace-pivot] backfilled lists.workspace_id on ${result[0]?.updated ?? 0} rows`,
  );
}

async function seedWorkspaceBots(defaultBotId: string): Promise<void> {
  const result = await db.execute<{ inserted: string }>(sql`
    WITH new_rows AS (
      INSERT INTO workspace_bots (workspace_id, bot_id, is_primary)
      SELECT w.id, ${defaultBotId}, false FROM workspaces w
      ON CONFLICT (workspace_id, bot_id) DO NOTHING
      RETURNING id
    )
    SELECT COUNT(*)::text AS inserted FROM new_rows
  `);
  console.log(
    `[workspace-pivot] seeded workspace_bots: ${result[0]?.inserted ?? 0} new rows`,
  );
}

async function seedBotUsers(defaultBotId: string): Promise<void> {
  const result = await db.execute<{ inserted: string }>(sql`
    WITH new_rows AS (
      INSERT INTO bot_users (bot_id, user_id, started_at)
      SELECT ${defaultBotId}, u.id, u.created_at FROM users u
      ON CONFLICT (bot_id, user_id) DO NOTHING
      RETURNING bot_id
    )
    SELECT COUNT(*)::text AS inserted FROM new_rows
  `);
  console.log(
    `[workspace-pivot] seeded bot_users: ${result[0]?.inserted ?? 0} new rows`,
  );
}

async function backfillItemStatus(): Promise<void> {
  // items.status default 'open' covers is_done=false rows automatically;
  // is_done=true rows need explicit 'done'. Idempotent (running again is a no-op).
  const result = await db.execute<{ updated: string }>(sql`
    WITH updated AS (
      UPDATE items SET status = 'done'
      WHERE is_done = true AND status <> 'done'
      RETURNING id
    )
    SELECT COUNT(*)::text AS updated FROM updated
  `);
  console.log(
    `[workspace-pivot] backfilled items.status on ${result[0]?.updated ?? 0} rows`,
  );
}

async function finalizeListsWorkspaceId(): Promise<void> {
  // Sanity check: zero null workspace_ids before flipping NOT NULL.
  const stillNull = await db.execute<{ count: string }>(
    sql`SELECT COUNT(*)::text AS count FROM lists WHERE workspace_id IS NULL`,
  );
  const nullCount = Number(stillNull[0]?.count ?? "0");
  if (nullCount > 0) {
    throw new Error(
      `finalizeListsWorkspaceId: ${nullCount} lists rows still have null workspace_id; backfill incomplete`,
    );
  }

  // Idempotent finalize: ALTER NOT NULL + drop old index + create new
  // index. PostgreSQL's IF EXISTS / IF NOT EXISTS makes re-runs safe.
  await db.execute(
    sql`ALTER TABLE lists ALTER COLUMN workspace_id SET NOT NULL`,
  );
  await db.execute(sql`DROP INDEX IF EXISTS lists_owner_inbox_unique`);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS lists_workspace_inbox_unique
    ON lists (workspace_id) WHERE is_inbox = true
  `);
  console.log(
    "[workspace-pivot] finalized lists.workspace_id NOT NULL + workspace_inbox_unique",
  );
}

async function verify(): Promise<void> {
  // Architect-pass § "Verification post-migration" — every check
  // expects 0 rows.
  const checks: Array<{ label: string; query: ReturnType<typeof sql> }> = [
    {
      label: "every user has Personal Workspace",
      query: sql`
        SELECT COUNT(*)::text AS c FROM users u
        LEFT JOIN workspaces w ON w.owner_id = u.id AND w.is_personal = true
        WHERE w.id IS NULL
      `,
    },
    {
      label: "every list has workspace_id",
      query: sql`SELECT COUNT(*)::text AS c FROM lists WHERE workspace_id IS NULL`,
    },
    {
      label: "every workspace has its owner as a member",
      query: sql`
        SELECT COUNT(*)::text AS c FROM workspaces w
        LEFT JOIN workspace_members m
          ON m.workspace_id = w.id AND m.user_id = w.owner_id AND m.role = 'owner'
        WHERE m.id IS NULL
      `,
    },
    {
      label: "exactly one default bot",
      query: sql`SELECT (COUNT(*) - 1)::text AS c FROM bots WHERE is_default = true`,
    },
    {
      label: "every user has bot_users row for default bot",
      query: sql`
        SELECT COUNT(*)::text AS c FROM users u
        LEFT JOIN bot_users bu ON bu.user_id = u.id
        LEFT JOIN bots b ON b.id = bu.bot_id AND b.is_default = true
        WHERE bu.user_id IS NULL
      `,
    },
    {
      label: "every workspace bound to default bot",
      query: sql`
        SELECT COUNT(*)::text AS c FROM workspaces w
        LEFT JOIN workspace_bots wb ON wb.workspace_id = w.id
        LEFT JOIN bots b ON b.id = wb.bot_id AND b.is_default = true
        WHERE wb.bot_id IS NULL
      `,
    },
    {
      label: "items.status backfill consistent with is_done",
      query: sql`
        SELECT COUNT(*)::text AS c FROM items
        WHERE (is_done = true) <> (status = 'done')
      `,
    },
  ];

  for (const { label, query } of checks) {
    const rows = await db.execute<{ c: string }>(query);
    const count = Number(rows[0]?.c ?? "0");
    if (count !== 0) {
      throw new Error(`Verification failed: ${label} — got ${count}, expected 0`);
    }
    console.log(`[workspace-pivot] ✓ ${label}`);
  }
}

async function main(): Promise<void> {
  console.log("[workspace-pivot] starting Phase 4.5 data migration");
  const defaultBotId = await seedDefaultBot();
  await seedPersonalWorkspaces();
  await backfillListsWorkspaceId();
  await seedWorkspaceBots(defaultBotId);
  await seedBotUsers(defaultBotId);
  await backfillItemStatus();
  await finalizeListsWorkspaceId();
  await verify();
  console.log("[workspace-pivot] complete ✓");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[workspace-pivot] FAILED:", err);
    process.exit(1);
  });
