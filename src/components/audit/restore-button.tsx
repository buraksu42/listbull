"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Undo2 } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { ApiError, apiPost } from "@/lib/api-client";
import type { ItemSnapshot } from "@/lib/types";

/**
 * F2 restore action — owner-only.
 *
 * The audit row already vetted `canRestore` server-side (Inv-21);
 * Backend re-checks the 30-day window again on POST for
 * defense-in-depth. We render the button only when `canRestore: true`
 * AND `disabled` falls back to a tooltip when the window has expired
 * since last poll.
 *
 * On success: invalidate the items cache for the list (so the restored
 * row re-appears in the list view) AND the audit cache (so the new
 * `item_created` row shows up). Optimistic add to items cache happens
 * via the response payload's `item: ItemSnapshot`.
 *
 * a11y: button label includes the item text, e.g. "Restore süt al".
 */
type RestoreResponse = {
  item: ItemSnapshot;
  /** New activity_log row id for the synthetic `item_created`. */
  newActivityLogId: string;
};

type RestoreButtonProps = {
  listId: string;
  activityLogId: string;
  /** Used in aria-label + toast copy. */
  itemText: string;
  /** Server-derived flag; false hides the button entirely. */
  canRestore: boolean;
  labels: {
    restore: string;
    restoring: string;
    restored: string;
    failed: string;
    unavailable: string;
  };
};

export function RestoreButton({
  listId,
  activityLogId,
  itemText,
  canRestore,
  labels,
}: RestoreButtonProps) {
  const queryClient = useQueryClient();

  const mutation = useMutation<RestoreResponse, ApiError, void>({
    mutationFn: async () => {
      return apiPost<RestoreResponse>(
        `/api/lists/${listId}/restore`,
        { activityLogId },
      );
    },
    onSuccess: (data) => {
      toast.success(labels.restored);
      // Optimistically add the item to the items cache for instant
      // re-appearance in the list view.
      queryClient.setQueryData<ItemSnapshot[] | undefined>(
        ["items", listId],
        (current) => {
          if (!current) return current;
          // Avoid duplicate inserts if the list has already been refetched.
          if (current.some((it) => it.id === data.item.id)) return current;
          return [...current, data.item];
        },
      );
      queryClient.invalidateQueries({ queryKey: ["items", listId] });
      queryClient.invalidateQueries({ queryKey: ["audit", listId] });
      queryClient.invalidateQueries({ queryKey: ["activity", listId] });
    },
    onError: (err) => {
      toast.error(restoreErrorCopy(err.code, labels.failed));
    },
  });

  if (!canRestore) {
    return (
      <span
        aria-disabled
        title={labels.unavailable}
        style={{
          fontSize: "var(--lb-fs-xs)",
          color: "var(--lb-muted-fg)",
        }}
      >
        {labels.unavailable}
      </span>
    );
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={mutation.isPending}
      onClick={() => mutation.mutate()}
      aria-label={`${labels.restore}: ${itemText}`}
    >
      <Undo2 className="h-4 w-4" aria-hidden />
      {mutation.isPending ? labels.restoring : labels.restore}
    </Button>
  );
}

function restoreErrorCopy(code: string, fallback: string): string {
  switch (code) {
    case "restore_window_expired":
      return "This item is too old to restore (30-day window).";
    case "restore_payload_invalid":
      return "Couldn't read the original item — restore unavailable.";
    case "forbidden":
      return "Only the list owner can restore.";
    case "not_found":
      return "Audit row not found.";
    default:
      return fallback;
  }
}
