"use client";

import { Bell, Plus, Trash2 } from "lucide-react";
import * as React from "react";

import {
  useAddReminder,
  useDeleteReminder,
  useReminders,
} from "@/hooks/use-reminders";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

/**
 * Reminder list + add affordance inside the item edit sheet.
 *
 * Two reminder kinds (Phase 14d):
 *   - 'absolute'        — fires at `remind_at`
 *   - 'before_deadline' — fires at `deadline - offset_minutes` (computed
 *                         server-side via `recomputeOffsetReminders`)
 *
 * Bot path supports recurrence rules (RRULE). UI here ships absolute +
 * before-deadline picks; recurrence is not yet exposed (see
 * docs/backlog.md). Quick-add only — no edit-in-place; delete + re-add
 * is the operation.
 */
export function RemindersSection({ itemId }: { itemId: string }) {
  const { data, isLoading } = useReminders(itemId);
  const add = useAddReminder(itemId);
  const del = useDeleteReminder(itemId);
  const [showAdd, setShowAdd] = React.useState(false);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span
          style={{
            fontSize: "var(--lb-fs-sm)",
            fontWeight: "var(--lb-fw-medium)",
          }}
        >
          Hatırlatmalar
        </span>
        <button
          type="button"
          onClick={() => setShowAdd((s) => !s)}
          className="inline-flex items-center gap-1 rounded-[var(--lb-r-sm)] border border-[var(--lb-border)] px-2 py-1 text-xs hover:bg-[var(--lb-card)]"
          style={{ color: "var(--lb-fg)" }}
        >
          <Plus size={12} aria-hidden="true" />
          Ekle
        </button>
      </div>

      {isLoading ? (
        <p className="text-xs text-[var(--lb-muted-fg)]">Yükleniyor…</p>
      ) : (data?.length ?? 0) === 0 && !showAdd ? (
        <p className="text-xs text-[var(--lb-muted-fg)]">
          Henüz hatırlatma yok. Bot&apos;tan da ekleyebilirsin: &quot;X için yarın
          18&apos;de hatırlat&quot;.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {(data ?? []).map((r) => {
            const when = new Date(r.remindAt);
            const labelTime = isNaN(when.getTime())
              ? r.remindAt
              : when.toLocaleString("tr-TR", {
                  dateStyle: "short",
                  timeStyle: "short",
                });
            const kindLabel =
              r.kind === "before_deadline"
                ? `${r.offsetMinutes ?? 0} dk önce`
                : r.recurrenceRule
                  ? "Tekrarlayan"
                  : "Tek seferlik";
            return (
              <li
                key={r.id}
                className={cn(
                  "flex items-center gap-2 rounded-[var(--lb-r-sm)] border border-[var(--lb-border)] px-2 py-1",
                  r.sent && "opacity-60",
                )}
              >
                <Bell size={12} aria-hidden="true" />
                <span className="flex-1 truncate text-xs">
                  {labelTime}
                  <span className="ml-2 text-[var(--lb-muted-fg)]">
                    {kindLabel}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    del.mutate(r.id, {
                      onError: (e) =>
                        toast.error(
                          e instanceof Error
                            ? e.message
                            : "Silinemedi",
                        ),
                    });
                  }}
                  aria-label="Sil"
                  className="text-[var(--lb-muted-fg)] hover:text-[var(--lb-destructive)]"
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {showAdd && (
        <AddReminderForm
          onSubmit={(input) => {
            add.mutate(input, {
              onSuccess: () => {
                setShowAdd(false);
              },
              onError: (e) =>
                toast.error(
                  e instanceof Error ? e.message : "Eklenemedi",
                ),
            });
          }}
          onCancel={() => setShowAdd(false)}
          submitting={add.isPending}
        />
      )}
    </div>
  );
}

type AddInput = {
  remindAt?: string;
  offsetMinutes?: number;
};

function AddReminderForm({
  onSubmit,
  onCancel,
  submitting,
}: {
  onSubmit: (input: AddInput) => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  const [mode, setMode] = React.useState<"absolute" | "before_deadline">(
    "absolute",
  );
  const [absoluteLocal, setAbsoluteLocal] = React.useState("");
  const [offset, setOffset] = React.useState<number>(15);
  const [unit, setUnit] = React.useState<"min" | "hour" | "day">("min");

  function submit() {
    if (mode === "absolute") {
      if (!absoluteLocal) return;
      const iso = new Date(absoluteLocal).toISOString();
      onSubmit({ remindAt: iso });
    } else {
      const offsetMinutes =
        unit === "min" ? offset : unit === "hour" ? offset * 60 : offset * 1440;
      onSubmit({ offsetMinutes });
    }
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-[var(--lb-r-sm)] border border-[var(--lb-border)] bg-[var(--lb-bg)] p-2"
      style={{ fontSize: "var(--lb-fs-xs)" }}
    >
      <div className="flex gap-1">
        <ModeChip
          active={mode === "absolute"}
          onClick={() => setMode("absolute")}
          label="Belirli zaman"
        />
        <ModeChip
          active={mode === "before_deadline"}
          onClick={() => setMode("before_deadline")}
          label="Son tarih öncesi"
        />
      </div>

      {mode === "absolute" ? (
        <input
          type="datetime-local"
          value={absoluteLocal}
          onChange={(e) => setAbsoluteLocal(e.target.value)}
          className="rounded-[var(--lb-r-sm)] border border-[var(--lb-border)] bg-[var(--lb-bg)] p-1 text-xs"
        />
      ) : (
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={0}
            value={offset}
            onChange={(e) => setOffset(Number(e.target.value))}
            className="w-16 rounded-[var(--lb-r-sm)] border border-[var(--lb-border)] bg-[var(--lb-bg)] p-1 text-xs"
          />
          <select
            value={unit}
            onChange={(e) =>
              setUnit(e.target.value as "min" | "hour" | "day")
            }
            className="rounded-[var(--lb-r-sm)] border border-[var(--lb-border)] bg-[var(--lb-bg)] p-1 text-xs"
          >
            <option value="min">dakika</option>
            <option value="hour">saat</option>
            <option value="day">gün</option>
          </select>
          <span className="text-[var(--lb-muted-fg)]">önce</span>
        </div>
      )}

      <div className="flex justify-end gap-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-[var(--lb-r-sm)] px-2 py-1 text-xs text-[var(--lb-muted-fg)]"
        >
          İptal
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={
            submitting ||
            (mode === "absolute" && !absoluteLocal) ||
            (mode === "before_deadline" && offset < 0)
          }
          className="rounded-[var(--lb-r-sm)] bg-[var(--lb-accent)] px-2 py-1 text-xs text-white disabled:opacity-50"
        >
          {submitting ? "…" : "Kaydet"}
        </button>
      </div>
      {mode === "before_deadline" && (
        <p className="text-[10px] text-[var(--lb-muted-fg)]">
          Son tarih ayarlı olmalı; yoksa hata döner.
        </p>
      )}
    </div>
  );
}

function ModeChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-[var(--lb-r-sm)] px-2 py-1 text-xs",
        active
          ? "bg-[var(--lb-accent)] text-white"
          : "border border-[var(--lb-border)] text-[var(--lb-fg)]",
      )}
    >
      {label}
    </button>
  );
}
