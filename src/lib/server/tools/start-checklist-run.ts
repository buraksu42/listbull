/**
 * Executor: `start_checklist_run` (Phase 17 stub).
 *
 * Checklist feature removed with the lists drop. Tool stays so the
 * LLM doesn't see a missing-tool error if it tries; returns a stable
 * success without persisting. Re-spec in a future phase.
 */
import "server-only";

import { ok } from "./_shared";
import type { ExecResult } from "./_shared";

export async function executeStartChecklistRun(
  _input: unknown,
  _ctx: { userId: string; chatId: number },
): Promise<ExecResult<{ ok: true }>> {
  return ok({ ok: true });
}
