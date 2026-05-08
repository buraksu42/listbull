"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import type { LucideIcon } from "lucide-react";

import {
  PRIORITY_META,
  STATUS_META,
} from "@/components/lists/item-attributes-meta";
import type {
  ItemPriority,
  ItemStatus,
} from "@/components/lists/item-filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useTelegramMainButton } from "@/hooks/use-telegram-main-button";
import type { Item } from "@/lib/types";

/**
 * Local form schema. Backend's authoritative validator (zod, server-side)
 * is the safety net; this is shape-aligned for client-side react-hook-form.
 */
const itemEditFormSchema = z.object({
  text: z.string().trim().min(1, "Required").max(2000, "≤2000 chars"),
  // <input type="datetime-local"> emits "YYYY-MM-DDTHH:mm" without timezone.
  // We coerce to ISO at submit time; empty string ↔ null.
  dueAtLocal: z.string().optional(),
  status: z.enum(["open", "in_progress", "blocked", "done"]),
  priority: z.enum(["low", "normal", "high"]),
  /** Comma-separated freeform tags; trimmed/dedup'd before submit. */
  tagsRaw: z.string().optional(),
});

type ItemEditFormValues = z.infer<typeof itemEditFormSchema>;

export type ItemEditPatch = {
  text?: string;
  dueAt?: string | null;
  status?: ItemStatus;
  priority?: ItemPriority;
  tags?: string[];
};

export function ItemEditSheet({
  item,
  open,
  onOpenChange,
  onSave,
}: {
  item: Item | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (patch: ItemEditPatch) => Promise<void>;
}) {
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ItemEditFormValues>({
    resolver: zodResolver(itemEditFormSchema),
    defaultValues: {
      text: item?.text ?? "",
      dueAtLocal: dateToLocalInput(item?.dueAt ?? null),
      status: (item?.status as ItemStatus) ?? "open",
      priority: (item?.priority as ItemPriority) ?? "normal",
      tagsRaw: (item?.tags ?? []).join(", "),
    },
  });

  // Reset the form whenever a different item is opened.
  React.useEffect(() => {
    if (!item) return;
    reset({
      text: item.text,
      dueAtLocal: dateToLocalInput(item.dueAt),
      status: (item.status as ItemStatus) ?? "open",
      priority: (item.priority as ItemPriority) ?? "normal",
      tagsRaw: (item.tags ?? []).join(", "),
    });
  }, [item, reset]);

  const onSubmit = handleSubmit(async (values) => {
    if (!item) return;
    const patch = diffPatch(item, values);
    if (Object.keys(patch).length === 0) {
      onOpenChange(false);
      return;
    }
    await onSave(patch);
    onOpenChange(false);
  });

  const submitFromMainButton = React.useCallback(() => {
    void onSubmit();
  }, [onSubmit]);

  // Telegram MainButton becomes the Save affordance when the sheet is
  // open and the form is dirty. Keeps Mini App native feel.
  useTelegramMainButton({
    visible: open && isDirty,
    text: "Save",
    onClick: submitFromMainButton,
    disabled: isSubmitting,
    loading: isSubmitting,
  });

  if (!item) {
    return null;
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent ariaLabel="Edit item">
        <form onSubmit={onSubmit} noValidate>
          <SheetHeader>
            <SheetTitle>Edit item</SheetTitle>
            <SheetDescription>
              Update text, status, priority, due date, and tags.
            </SheetDescription>
          </SheetHeader>

          <SheetBody className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="item-edit-text">Text</Label>
              <Input
                id="item-edit-text"
                autoFocus
                {...register("text")}
                aria-invalid={Boolean(errors.text)}
                aria-describedby={errors.text ? "item-edit-text-error" : undefined}
              />
              {errors.text && (
                <p
                  id="item-edit-text-error"
                  className="text-sm text-[var(--lb-destructive)]"
                >
                  {errors.text.message}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label>Durum</Label>
              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <PickerRow
                    options={STATUS_META.map((m) => ({
                      value: m.value,
                      label: m.label,
                      Icon: m.Icon,
                      color: m.color,
                    }))}
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label>Öncelik</Label>
              <Controller
                control={control}
                name="priority"
                render={({ field }) => (
                  <PickerRow
                    options={PRIORITY_META.map((m) => ({
                      value: m.value,
                      label: m.label,
                      Icon: m.Icon,
                      color: m.color,
                    }))}
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="item-edit-due">Due (optional)</Label>
              <Input
                id="item-edit-due"
                type="datetime-local"
                {...register("dueAtLocal")}
              />
              <p className="text-xs text-[var(--lb-muted-fg)]">
                Leave empty to clear the reminder.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="item-edit-tags">Etiketler</Label>
              <Input
                id="item-edit-tags"
                placeholder="iş, acil, fatura"
                {...register("tagsRaw")}
              />
              <p className="text-xs text-[var(--lb-muted-fg)]">
                Virgülle ayır. Workspace içinde en fazla 20 farklı etiket.
              </p>
            </div>
          </SheetBody>

          <SheetFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !isDirty}>
              {isSubmitting ? "Saving…" : "Save"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function PickerRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{
    value: T;
    label: string;
    Icon: LucideIcon;
    color?: string;
  }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 10px",
              borderRadius: "999px",
              fontSize: "var(--lb-fs-sm)",
              cursor: "pointer",
              background: active ? "var(--lb-accent)" : "var(--lb-card)",
              color: active ? "var(--lb-accent-fg)" : o.color ?? "var(--lb-fg)",
              border: `1px solid ${active ? "var(--lb-accent)" : "var(--lb-border)"}`,
            }}
          >
            <o.Icon size={14} aria-hidden="true" />
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function dateToLocalInput(iso: Date | string | null): string {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function parseTags(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0),
    ),
  );
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function diffPatch(item: Item, values: ItemEditFormValues): ItemEditPatch {
  const patch: ItemEditPatch = {};
  if (values.text.trim() !== item.text) {
    patch.text = values.text.trim();
  }
  const nextDue = localInputToIso(values.dueAtLocal ?? "");
  const currentDue = item.dueAt ? new Date(item.dueAt).toISOString() : null;
  if (nextDue !== currentDue) {
    patch.dueAt = nextDue;
  }
  const currentStatus = (item.status as ItemStatus) ?? "open";
  if (values.status !== currentStatus) {
    patch.status = values.status;
  }
  const currentPriority = (item.priority as ItemPriority) ?? "normal";
  if (values.priority !== currentPriority) {
    patch.priority = values.priority;
  }
  const nextTags = parseTags(values.tagsRaw ?? "");
  const currentTags = (item.tags ?? []).map((t) => t.toLowerCase());
  if (!arraysEqual(nextTags, currentTags)) {
    patch.tags = nextTags;
  }
  return patch;
}
