"use client";

/**
 * Phase 16: TanStack Query hooks for checklist run operations.
 *
 * Mutations invalidate both the runs cache AND the items cache —
 * `start_checklist_run` resets every item, so the items list is
 * stale immediately after a successful start.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ListRunSnapshot } from "@/lib/types";

export const runsKey = (listId: string) =>
  ["lists", listId, "runs"] as const;

const POLL_INTERVAL = 30_000;

type ListResponse = { ok: true; data: { runs: ListRunSnapshot[] } };

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      detail = body?.error?.message ?? "";
    } catch {
      /* swallow */
    }
    throw new Error(detail || `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export function useChecklistRuns(listId: string | null) {
  return useQuery({
    queryKey: listId ? runsKey(listId) : ["lists", "none", "runs"],
    queryFn: async () => {
      if (!listId) return [] as ListRunSnapshot[];
      const json = await fetchJson<ListResponse>(
        `/api/lists/${listId}/runs`,
      );
      return json.data.runs;
    },
    enabled: listId !== null,
    refetchInterval: POLL_INTERVAL,
    staleTime: POLL_INTERVAL,
  });
}

export function useStartChecklistRun(listId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      return fetchJson<unknown>(`/api/lists/${listId}/runs?action=start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    },
    onSuccess: () => {
      // Reset clears every item to open — items list is stale.
      qc.invalidateQueries({ queryKey: ["items", listId] });
      qc.invalidateQueries({ queryKey: runsKey(listId) });
    },
  });
}

export function useCompleteChecklistRun(listId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      return fetchJson<unknown>(`/api/lists/${listId}/runs?action=complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: runsKey(listId) });
    },
  });
}
