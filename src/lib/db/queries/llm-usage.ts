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
import { llmUsage, users } from "@/lib/db/schema";

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
