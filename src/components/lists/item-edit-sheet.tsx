"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import * as React from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

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
 * is the safety net; this is shape-aligned for client-side react-hook-form
 * but lives client-private to avoid coupling to validators that may still
 * be evolving while Backend ships in parallel.
 */
const itemEditFormSchema = z.object({
  text: z.string().trim().min(1, "Required").max(2000, "≤2000 chars"),
  // <input type="datetime-local"> emits "YYYY-MM-DDTHH:mm" without timezone.
  // We coerce to ISO at submit time; empty string ↔ null.
  dueAtLocal: z.string().optional(),
});

type ItemEditFormValues = z.infer<typeof itemEditFormSchema>;

export type ItemEditPatch = {
  text?: string;
  dueAt?: string | null;
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
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ItemEditFormValues>({
    resolver: zodResolver(itemEditFormSchema),
    defaultValues: {
      text: item?.text ?? "",
      dueAtLocal: dateToLocalInput(item?.dueAt ?? null),
    },
  });

  // Reset the form whenever a different item is opened.
  React.useEffect(() => {
    if (!item) return;
    reset({
      text: item.text,
      dueAtLocal: dateToLocalInput(item.dueAt),
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
            <SheetDescription>Update text or due date.</SheetDescription>
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
  return patch;
}
