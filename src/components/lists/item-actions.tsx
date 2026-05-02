"use client";

import { Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Per-row actions cluster — Edit + Delete icon buttons. We deliberately
 * skip a hidden "..." menu in favor of two visible buttons: tap targets
 * stay 44px, screen-reader users get explicit affordances, and there's
 * one fewer layer of state to manage.
 */
export function ItemActions({
  onEdit,
  onDelete,
  className,
  itemLabel,
}: {
  onEdit: () => void;
  onDelete: () => void;
  className?: string;
  itemLabel: string;
}) {
  return (
    <div
      className={cn("flex items-center gap-1", className)}
      onClick={(e) => e.stopPropagation()}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Edit ${itemLabel}`}
        onClick={onEdit}
      >
        <Pencil
          className="h-4 w-4"
          style={{ color: "var(--lb-muted-fg)" }}
          aria-hidden
        />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Delete ${itemLabel}`}
        onClick={onDelete}
      >
        <Trash2
          className="h-4 w-4"
          style={{ color: "var(--lb-muted-fg)" }}
          aria-hidden
        />
      </Button>
    </div>
  );
}
