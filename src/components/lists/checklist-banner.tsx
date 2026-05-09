"use client";

/**
 * Phase 16: checklist banner. Renders above the item list when
 * `lists.is_checklist=true`.
 *
 *   - "Yeni run başlat" primary action — closes the active run (if
 *     any) and resets every item's state.
 *   - "Run'ı bitir" secondary action — captures the active run's
 *     completion stats without resetting items.
 *   - Run history strip: last 5 runs, each showing N/M completion +
 *     elapsed time. Tap-to-expand surfaces older runs (later phase).
 */
import { CheckCheck, Play, RotateCcw } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  useChecklistRuns,
  useCompleteChecklistRun,
  useStartChecklistRun,
} from "@/hooks/use-checklist-runs";

const HISTORY_PREVIEW = 5;

export function ChecklistBanner({ listId }: { listId: string }) {
  const runsQuery = useChecklistRuns(listId);
  const startMutation = useStartChecklistRun(listId);
  const completeMutation = useCompleteChecklistRun(listId);

  const runs = runsQuery.data ?? [];
  const activeRun = runs.find((r) => r.completedAt === null) ?? null;
  const recent = runs.slice(0, HISTORY_PREVIEW);

  const onStart = () => {
    startMutation.mutate(undefined, {
      onSuccess: () => {
        toast.success("Yeni run başlatıldı, tüm maddeler sıfırlandı.");
      },
      onError: (err) => {
        toast.error(
          err instanceof Error ? err.message : "Run başlatılamadı.",
        );
      },
    });
  };

  const onComplete = () => {
    completeMutation.mutate(undefined, {
      onSuccess: () => {
        toast.success("Run tamamlandı.");
      },
      onError: (err) => {
        toast.error(
          err instanceof Error ? err.message : "Run kapatılamadı.",
        );
      },
    });
  };

  return (
    <section
      aria-label="Checklist kontrolleri"
      className="flex flex-col gap-3 border-b border-[var(--lb-border)] p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={onStart}
          disabled={startMutation.isPending}
        >
          <span className="inline-flex items-center gap-1.5">
            {activeRun ? (
              <>
                <RotateCcw size={14} aria-hidden="true" />
                Yeni run başlat
              </>
            ) : (
              <>
                <Play size={14} aria-hidden="true" />
                Run başlat
              </>
            )}
          </span>
        </Button>
        {activeRun && (
          <Button
            type="button"
            variant="ghost"
            onClick={onComplete}
            disabled={completeMutation.isPending}
          >
            <span className="inline-flex items-center gap-1.5">
              <CheckCheck size={14} aria-hidden="true" />
              Run&apos;ı bitir
            </span>
          </Button>
        )}
      </div>

      {activeRun && (
        <p className="text-xs text-[var(--lb-muted-fg)]">
          Aktif run: {formatRelative(activeRun.startedAt)} ·{" "}
          {activeRun.itemsTotal} madde
        </p>
      )}

      {recent.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-[11px] uppercase tracking-wide text-[var(--lb-muted-fg)]">
            Geçmiş runlar ({runs.length})
          </p>
          <ul className="flex flex-col gap-1 text-xs">
            {recent.map((run) => (
              <li
                key={run.id}
                className="flex items-center justify-between gap-2"
              >
                <span className="text-[var(--lb-fg)]">
                  {formatRelative(run.startedAt)}
                  {run.completedAt !== null && (
                    <span className="text-[var(--lb-muted-fg)]">
                      {" "}
                      → {formatRelative(run.completedAt)}
                    </span>
                  )}
                </span>
                <span className="text-[var(--lb-muted-fg)]">
                  {run.completedAt === null
                    ? "aktif"
                    : `${run.itemsCompleted ?? 0}/${run.itemsTotal}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** Compact "5 dk önce" / "2 gün önce" / fallback ISO. */
function formatRelative(iso: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "şimdi";
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} sa önce`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} gün önce`;
  return date.toLocaleDateString();
}
