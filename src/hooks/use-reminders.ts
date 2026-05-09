"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ItemReminderSnapshot } from "@/lib/types";

const reminderKey = (itemId: string) => ["reminders", itemId] as const;

type AddReminderInput = {
  remindAt?: string;
  offsetMinutes?: number;
  recurrenceRule?: string | null;
};

type ListResponse = {
  ok: true;
  data: { reminders: ItemReminderSnapshot[] };
} | {
  ok: false;
  error: { code: string; message: string };
};

type AddResponse = {
  ok: true;
  data: { reminder: ItemReminderSnapshot; kind: "absolute" | "before_deadline" };
} | {
  ok: false;
  error: { code: string; message: string };
};

export function useReminders(itemId: string | null | undefined) {
  return useQuery({
    queryKey: itemId ? reminderKey(itemId) : ["reminders", "no-id"],
    enabled: Boolean(itemId),
    queryFn: async (): Promise<ItemReminderSnapshot[]> => {
      if (!itemId) return [];
      const res = await fetch(`/api/items/${encodeURIComponent(itemId)}/reminders`, {
        credentials: "same-origin",
      });
      const json = (await res.json()) as ListResponse;
      if (!json.ok) throw new Error(json.error.message);
      return json.data.reminders;
    },
    staleTime: 5_000,
  });
}

export function useAddReminder(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AddReminderInput) => {
      const res = await fetch(`/api/items/${encodeURIComponent(itemId)}/reminders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(input),
      });
      const json = (await res.json()) as AddResponse;
      if (!json.ok) throw new Error(json.error.message);
      return json.data.reminder;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: reminderKey(itemId) });
    },
  });
}

export function useDeleteReminder(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (reminderId: string) => {
      const res = await fetch(
        `/api/items/${encodeURIComponent(itemId)}/reminders/${encodeURIComponent(reminderId)}`,
        { method: "DELETE", credentials: "same-origin" },
      );
      if (!res.ok) {
        const json = (await res.json()) as ListResponse;
        if ("error" in json) throw new Error(json.error.message);
        throw new Error("delete failed");
      }
      return reminderId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: reminderKey(itemId) });
    },
  });
}
