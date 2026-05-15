/**
 * Executor: `complete_checklist_run` (Phase 17 stub).
 */
import "server-only";

import { ok } from "./_shared";
import type { ExecResult } from "./_shared";

export async function executeCompleteChecklistRun(
  _input: unknown,
  _ctx: { userId: string; chatId: number },
): Promise<ExecResult<{ ok: true }>> {
  return ok({ ok: true });
}
