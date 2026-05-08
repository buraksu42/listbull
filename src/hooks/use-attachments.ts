"use client";

/**
 * Phase 14b: TanStack Query hook around the per-item attachments list.
 *
 * No optimistic updates — attachments are mutated bot-side (uploads
 * arrive via Telegram intake) and the Mini App just renders +
 * deletes. Polling cadence matches the items list (5s) so a freshly
 * attached file appears quickly without manual refresh.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { AttachmentSnapshot } from "@/lib/types";

const POLL_INTERVAL = 5_000;

type ListResponse = {
  ok: true;
  data: { attachments: AttachmentSnapshot[] };
};

export const attachmentsKey = (itemId: string) =>
  ["attachments", itemId] as const;

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

export function useAttachments(itemId: string | null) {
  return useQuery({
    queryKey: itemId ? attachmentsKey(itemId) : ["attachments", "none"],
    queryFn: async () => {
      if (!itemId) return [] as AttachmentSnapshot[];
      const json = await fetchJson<ListResponse>(
        `/api/items/${itemId}/attachments`,
      );
      return json.data.attachments;
    },
    enabled: itemId !== null,
    refetchInterval: POLL_INTERVAL,
    staleTime: POLL_INTERVAL,
  });
}

export function useDeleteAttachment(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (attachmentId: string) => {
      await fetchJson(`/api/attachments/${itemId}/${attachmentId}`, {
        method: "DELETE",
      });
      return attachmentId;
    },
    onSuccess: (attachmentId) => {
      qc.setQueryData<AttachmentSnapshot[]>(
        attachmentsKey(itemId),
        (current) => (current ?? []).filter((a) => a.id !== attachmentId),
      );
      // Items list shows attachment count via Paperclip badge; keep it
      // in sync.
      qc.invalidateQueries({ queryKey: ["items"] });
    },
  });
}

/** Public byte URL the Mini App can `<img src=...>` or fetch from. */
export function attachmentBytesUrl(itemId: string, attachmentId: string): string {
  return `/api/attachments/${itemId}/${attachmentId}`;
}
