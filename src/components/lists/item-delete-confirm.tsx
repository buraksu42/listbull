"use client";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { Item } from "@/lib/types";

/**
 * Destructive confirm — soft-delete is reversible per Architect's contract,
 * but the user should still hit a friction step before the row vanishes.
 */
export function ItemDeleteConfirm({
  item,
  open,
  onOpenChange,
  onConfirm,
  pending = false,
}: {
  item: Item | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
  pending?: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent ariaLabel="Confirm delete">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this item?</AlertDialogTitle>
          <AlertDialogDescription>
            {item ? `“${item.text}” will be removed from the list.` : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <div data-alert-cancel="true">
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
          </div>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={async () => {
              await onConfirm();
              onOpenChange(false);
            }}
          >
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
