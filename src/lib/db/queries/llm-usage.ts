/**
 * llm_usage write + read helpers (Phase 7).
 *
 * Single insertOne per LLM turn — called from handle-message after
 * respond() resolves. Read aggregates power the workspace admin
 * dashboard "spend" section.
 */
import { and, desc, eq, gte, sql } from "drizzle-orm";

import { calculateCostUsdMicro } from "@/lib/billing/model-pricing";
import { db } from "@/lib/db/client";
import { llmUsage, users, workspaceMemberCaps } from "@/lib/db/schema";

export type LlmKeySource = "user" | "workspace" | "operator";

export type RecordLlmUsageInput = {
  userId: string;
  workspaceId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  /**
   * Optional explicit cost (e.g. provider returned cost in headers).
   * When omitted, derived from MODEL_PRICING × tokens. Returns 0 for
   * models not in the rate card.
   */
  costUsdMicro?: number;
  keySource: LlmKeySource;
};

export async function recordLlmUsage(
  input: RecordLlmUsageInput,
): Promise<void> {
  // Skip the insert when both token counts are 0 — happens on
  // sentinel returns (NO_KEY) where no LLM call was made. Saves a
  // useless row per dropped turn.
  if (input.promptTokens === 0 && input.completionTokens === 0) return;

  // Phase 8: derive cost from MODEL_PRICING when not supplied.
  const cost =
    input.costUsdMicro ??
    calculateCostUsdMicro(
      input.model,
      input.promptTokens,
      input.completionTokens,
    );

  await db.insert(llmUsage).values({
    userId: input.userId,
    workspaceId: input.workspaceId,
    model: input.model,
    promptTokens: input.promptTokens,
    completionTokens: input.completionTokens,
    costUsdMicro: cost,
    keySource: input.keySource,
  });
}

export type WorkspaceLlmSpendSummary = {
  windowDays: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCostUsdMicro: number;
  byModel: Array<{
    model: string;
    promptTokens: number;
    completionTokens: number;
    costUsdMicro: number;
    callCount: number;
  }>;
  byMember: Array<{
    userId: string;
    telegramFirstName: string;
    telegramUsername: string | null;
    promptTokens: number;
    completionTokens: number;
    costUsdMicro: number;
    callCount: number;
  }>;
};

/**
 * Per-user LLM usage summary (last N days). Lighter view — total
 * tokens + call count, no per-model breakdown. Powers the settings
 * page footprint badge.
 */
export type UserLlmUsageSummary = {
  windowDays: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCostUsdMicro: number;
  callCount: number;
};

export async function getUserLlmUsage(
  userId: string,
  windowDays: number = 30,
): Promise<UserLlmUsageSummary> {
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({
      promptTokens: sql<number>`coalesce(sum(${llmUsage.promptTokens}), 0)::int`,
      completionTokens: sql<number>`coalesce(sum(${llmUsage.completionTokens}), 0)::int`,
      costUsdMicro: sql<number>`coalesce(sum(${llmUsage.costUsdMicro}), 0)::int`,
      callCount: sql<number>`count(*)::int`,
    })
    .from(llmUsage)
    .where(
      and(
        eq(llmUsage.userId, userId),
        gte(llmUsage.createdAt, cutoff),
      ),
    );
  return {
    windowDays,
    totalPromptTokens: row?.promptTokens ?? 0,
    totalCompletionTokens: row?.completionTokens ?? 0,
    totalCostUsdMicro: row?.costUsdMicro ?? 0,
    callCount: row?.callCount ?? 0,
  };
}

/**
 * Phase 8 daily series for the trend sparkline. Returns one row per
 * day in the window with token + cost totals. Days with no usage
 * surface as zero rows so the chart renders a continuous line.
 */
export type WorkspaceLlmDailyPoint = {
  /** ISO date string (YYYY-MM-DD, UTC bucket boundary). */
  day: string;
  promptTokens: number;
  completionTokens: number;
  costUsdMicro: number;
  callCount: number;
};

export async function getWorkspaceLlmDailySeries(
  workspaceId: string,
  windowDays: number = 30,
): Promise<WorkspaceLlmDailyPoint[]> {
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const rows = await db.execute<{
    day: string;
    prompt_tokens: number;
    completion_tokens: number;
    cost_usd_micro: number;
    call_count: number;
  }>(sql`
    SELECT
      to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
      coalesce(sum(prompt_tokens), 0)::int AS prompt_tokens,
      coalesce(sum(completion_tokens), 0)::int AS completion_tokens,
      coalesce(sum(cost_usd_micro), 0)::int AS cost_usd_micro,
      count(*)::int AS call_count
    FROM llm_usage
    WHERE workspace_id = ${workspaceId}
      AND created_at >= ${cutoff.toISOString()}
    GROUP BY day
    ORDER BY day ASC
  `);

  const byDay = new Map<string, (typeof rows)[number]>();
  for (const r of rows) byDay.set(r.day, r);

  // Continuous series: fill zero rows for days with no usage so the
  // chart renders a smooth line.
  const series: WorkspaceLlmDailyPoint[] = [];
  const start = new Date(
    Date.UTC(
      cutoff.getUTCFullYear(),
      cutoff.getUTCMonth(),
      cutoff.getUTCDate(),
    ),
  );
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    const r = byDay.get(key);
    series.push({
      day: key,
      promptTokens: r?.prompt_tokens ?? 0,
      completionTokens: r?.completion_tokens ?? 0,
      costUsdMicro: r?.cost_usd_micro ?? 0,
      callCount: r?.call_count ?? 0,
    });
  }

  return series;
}

/**
 * Last-N-days workspace spend summary. Default 30d window. Returns
 * totals + per-model + per-member breakdowns.
 */
export async function getWorkspaceLlmSpend(
  workspaceId: string,
  windowDays: number = 30,
): Promise<WorkspaceLlmSpendSummary> {
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  // Per-model rollup.
  const modelRows = await db
    .select({
      model: llmUsage.model,
      promptTokens: sql<number>`coalesce(sum(${llmUsage.promptTokens}), 0)::int`,
      completionTokens: sql<number>`coalesce(sum(${llmUsage.completionTokens}), 0)::int`,
      costUsdMicro: sql<number>`coalesce(sum(${llmUsage.costUsdMicro}), 0)::int`,
      callCount: sql<number>`count(*)::int`,
    })
    .from(llmUsage)
    .where(
      and(
        eq(llmUsage.workspaceId, workspaceId),
        gte(llmUsage.createdAt, cutoff),
      ),
    )
    .groupBy(llmUsage.model)
    .orderBy(desc(sql`sum(${llmUsage.promptTokens} + ${llmUsage.completionTokens})`));

  // Per-member rollup with joined display info.
  const memberRows = await db
    .select({
      userId: llmUsage.userId,
      telegramFirstName: users.telegramFirstName,
      telegramUsername: users.telegramUsername,
      promptTokens: sql<number>`coalesce(sum(${llmUsage.promptTokens}), 0)::int`,
      completionTokens: sql<number>`coalesce(sum(${llmUsage.completionTokens}), 0)::int`,
      costUsdMicro: sql<number>`coalesce(sum(${llmUsage.costUsdMicro}), 0)::int`,
      callCount: sql<number>`count(*)::int`,
    })
    .from(llmUsage)
    .innerJoin(users, eq(users.id, llmUsage.userId))
    .where(
      and(
        eq(llmUsage.workspaceId, workspaceId),
        gte(llmUsage.createdAt, cutoff),
      ),
    )
    .groupBy(llmUsage.userId, users.telegramFirstName, users.telegramUsername)
    .orderBy(
      desc(sql`sum(${llmUsage.promptTokens} + ${llmUsage.completionTokens})`),
    );

  let totalPrompt = 0;
  let totalCompletion = 0;
  let totalCost = 0;
  for (const r of modelRows) {
    totalPrompt += r.promptTokens;
    totalCompletion += r.completionTokens;
    totalCost += r.costUsdMicro;
  }

  return {
    windowDays,
    totalPromptTokens: totalPrompt,
    totalCompletionTokens: totalCompletion,
    totalCostUsdMicro: totalCost,
    byModel: modelRows,
    byMember: memberRows,
  };
}

// ─── Phase 8: per-member spend caps ─────────────────────────────────

export type MemberCap = {
  workspaceId: string;
  userId: string;
  dailyCapUsdMicro: number;
  monthlyCapUsdMicro: number;
};

export async function getMemberCap(
  workspaceId: string,
  userId: string,
): Promise<MemberCap | null> {
  const [row] = await db
    .select({
      workspaceId: workspaceMemberCaps.workspaceId,
      userId: workspaceMemberCaps.userId,
      dailyCapUsdMicro: workspaceMemberCaps.dailyCapUsdMicro,
      monthlyCapUsdMicro: workspaceMemberCaps.monthlyCapUsdMicro,
    })
    .from(workspaceMemberCaps)
    .where(
      and(
        eq(workspaceMemberCaps.workspaceId, workspaceId),
        eq(workspaceMemberCaps.userId, userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listMemberCaps(
  workspaceId: string,
): Promise<MemberCap[]> {
  return await db
    .select({
      workspaceId: workspaceMemberCaps.workspaceId,
      userId: workspaceMemberCaps.userId,
      dailyCapUsdMicro: workspaceMemberCaps.dailyCapUsdMicro,
      monthlyCapUsdMicro: workspaceMemberCaps.monthlyCapUsdMicro,
    })
    .from(workspaceMemberCaps)
    .where(eq(workspaceMemberCaps.workspaceId, workspaceId));
}

export async function upsertMemberCap(input: MemberCap): Promise<void> {
  // Drizzle supports onConflictDoUpdate; relying on the unique
  // (workspace_id, user_id) index from the schema.
  await db
    .insert(workspaceMemberCaps)
    .values({
      workspaceId: input.workspaceId,
      userId: input.userId,
      dailyCapUsdMicro: input.dailyCapUsdMicro,
      monthlyCapUsdMicro: input.monthlyCapUsdMicro,
    })
    .onConflictDoUpdate({
      target: [workspaceMemberCaps.workspaceId, workspaceMemberCaps.userId],
      set: {
        dailyCapUsdMicro: input.dailyCapUsdMicro,
        monthlyCapUsdMicro: input.monthlyCapUsdMicro,
        updatedAt: new Date(),
      },
    });
}

export async function deleteMemberCap(
  workspaceId: string,
  userId: string,
): Promise<void> {
  await db
    .delete(workspaceMemberCaps)
    .where(
      and(
        eq(workspaceMemberCaps.workspaceId, workspaceId),
        eq(workspaceMemberCaps.userId, userId),
      ),
    );
}

/**
 * Pre-call cap check. Returns the action to take based on the
 * member's current daily + 30d spend vs configured caps. Only
 * relevant when keySource === 'workspace' — caps don't apply to
 * personal BYOK or operator fallback.
 *
 * Caps of 0 = unlimited (default). Cap exceeded → block. Otherwise
 * allow.
 */
export type CapCheckResult =
  | { ok: true }
  | {
      ok: false;
      reason: "daily_cap_exceeded" | "monthly_cap_exceeded";
      capUsdMicro: number;
      currentUsdMicro: number;
    };

export async function checkMemberCap(
  workspaceId: string,
  userId: string,
): Promise<CapCheckResult> {
  const cap = await getMemberCap(workspaceId, userId);
  if (!cap) return { ok: true };
  if (cap.dailyCapUsdMicro === 0 && cap.monthlyCapUsdMicro === 0) {
    return { ok: true };
  }

  // Compute current spend (from this user, on this workspace's
  // org-key — keySource='workspace') in both windows.
  const today = new Date();
  const dayCutoff = new Date(
    Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate(),
    ),
  );
  const monthCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [row] = await db
    .select({
      dayCost: sql<number>`coalesce(sum(case when ${llmUsage.createdAt} >= ${dayCutoff.toISOString()} then ${llmUsage.costUsdMicro} else 0 end), 0)::int`,
      monthCost: sql<number>`coalesce(sum(${llmUsage.costUsdMicro}), 0)::int`,
    })
    .from(llmUsage)
    .where(
      and(
        eq(llmUsage.workspaceId, workspaceId),
        eq(llmUsage.userId, userId),
        eq(llmUsage.keySource, "workspace"),
        gte(llmUsage.createdAt, monthCutoff),
      ),
    );

  const dayCost = row?.dayCost ?? 0;
  const monthCost = row?.monthCost ?? 0;

  if (cap.dailyCapUsdMicro > 0 && dayCost >= cap.dailyCapUsdMicro) {
    return {
      ok: false,
      reason: "daily_cap_exceeded",
      capUsdMicro: cap.dailyCapUsdMicro,
      currentUsdMicro: dayCost,
    };
  }
  if (cap.monthlyCapUsdMicro > 0 && monthCost >= cap.monthlyCapUsdMicro) {
    return {
      ok: false,
      reason: "monthly_cap_exceeded",
      capUsdMicro: cap.monthlyCapUsdMicro,
      currentUsdMicro: monthCost,
    };
  }
  return { ok: true };
}
