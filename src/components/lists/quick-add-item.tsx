"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import * as React from "react";

import { toast } from "@/components/ui/sonner";
import { ApiError, apiPost } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { Item } from "@/lib/types";

const itemsKey = (listId: string) => ["items", listId] as const;

type QuickAddResponse = {
  ok: true;
  data: { item: Item | null };
};

type Props = {
  listId: string;
  /** Hide entirely for viewers / non-members. */
  canAdd: boolean;
};

/**
 * Inline "add a to-do" row mounted above the item list.
 *
 * Input + plus-button. Enter submits. Optimistic insert (placeholder
 * row with a tmp id) lands instantly; server returns the canonical row
 * and we swap. Errors roll back the optimistic row.
 *
 * Hidden for non-members and viewers.
 */
export function QuickAddItem({ listId, canAdd }: Props) {
  const [text, setText] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation<
    QuickAddResponse,
    ApiError,
    { tmpId: string; text: string },
    { previous?: Item[] }
  >({
    mutationFn: async ({ text }) => {
      return apiPost<QuickAddResponse>(`/api/lists/${listId}/items`, {
        text,
      });
    },
    onMutate: async ({ tmpId, text }) => {
      await queryClient.cancelQueries({ queryKey: itemsKey(listId) });
      const previous = queryClient.getQueryData<Item[]>(itemsKey(listId));
      const optimistic: Item = {
        id: tmpId,
        listId,
        text,
        description: null,
        isCheckable: true,
        isDone: false,
        status: "open",
        priority: "normal",
        tags: [],
        assigneeId: null,
        deadlineAt: null,
        pinnedAt: null,
        taskRecurrenceRule: null,
        position: (previous?.length ?? 0) + 1000,
        createdBy: "",
        completedAt: null,
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      queryClient.setQueryData<Item[]>(itemsKey(listId), (current) => [
        ...(current ?? []),
        optimistic,
      ]);
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(itemsKey(listId), ctx.previous);
      }
      toast.error(err.message || "Eklenemedi");
    },
    onSuccess: (response, { tmpId }) => {
      // Replace the optimistic row with the server one.
      queryClient.setQueryData<Item[]>(itemsKey(listId), (current) =>
        (current ?? []).map((it) =>
          it.id === tmpId ? (response.data.item ?? it) : it,
        ),
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: itemsKey(listId) });
    },
  });

  if (!canAdd) return null;

  function submit() {
    const cleaned = text.trim();
    if (cleaned.length === 0 || mutation.isPending) return;
    const tmpId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    mutation.mutate({ tmpId, text: cleaned });
    setText("");
    // Keep focus for rapid serial entry.
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--lb-sp-2)",
        padding: "var(--lb-sp-2) var(--lb-sp-3)",
        borderBottom: "1px solid var(--lb-border)",
        background: "var(--lb-bg)",
      }}
    >
      <button
        type="submit"
        aria-label="Add item"
        disabled={mutation.isPending || text.trim().length === 0}
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-full",
          "bg-[var(--lb-accent)] text-[var(--lb-accent-fg)]",
          "disabled:opacity-50",
        )}
      >
        <Plus className="h-4 w-4" />
      </button>
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Yeni item ekle…"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="sentences"
        spellCheck={false}
        enterKeyHint="done"
        style={{
          flex: 1,
          padding: "var(--lb-sp-2) var(--lb-sp-3)",
          fontSize: "var(--lb-fs-base)",
          background: "transparent",
          border: "none",
          outline: "none",
          color: "var(--lb-fg)",
        }}
      />
    </form>
  );
}
