"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * AlertDialog — confirm-destructive primitive. Centered modal; Esc + backdrop
 * click both dismiss; focus moves to the cancel button on open.
 */
type AlertDialogContextValue = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const AlertDialogContext = React.createContext<AlertDialogContextValue | null>(
  null,
);

function useAlertDialog(): AlertDialogContextValue {
  const ctx = React.useContext(AlertDialogContext);
  if (!ctx)
    throw new Error("AlertDialog primitives must be used inside <AlertDialog>");
  return ctx;
}

export function AlertDialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <AlertDialogContext.Provider value={{ open, onOpenChange }}>
      {children}
    </AlertDialogContext.Provider>
  );
}

export function AlertDialogContent({
  className,
  children,
  ariaLabel,
}: {
  className?: string;
  children: React.ReactNode;
  ariaLabel?: string;
}) {
  const { open, onOpenChange } = useAlertDialog();
  const cancelRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Focus the first cancel-style action if present.
    const t = setTimeout(() => {
      const node = cancelRef.current;
      const focusable = node?.querySelector<HTMLElement>(
        "[data-alert-cancel='true']",
      );
      focusable?.focus();
    }, 0);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      clearTimeout(t);
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={() => onOpenChange(false)}
        className="absolute inset-0 bg-black/50"
      />
      <div
        ref={cancelRef}
        role="alertdialog"
        aria-modal="true"
        aria-label={ariaLabel ?? "Confirm"}
        className={cn(
          "relative w-full max-w-sm rounded-[var(--lb-r-lg)] border border-[var(--lb-border)] bg-[var(--lb-card)] text-[var(--lb-card-fg)] shadow-[var(--lb-shadow-popover)]",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function AlertDialogHeader({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5 p-4 text-left", className)}>
      {children}
    </div>
  );
}

export function AlertDialogTitle({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <h2
      className={cn(
        "text-lg font-semibold text-[var(--lb-fg)]",
        className,
      )}
    >
      {children}
    </h2>
  );
}

export function AlertDialogDescription({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <p
      className={cn(
        "text-sm text-[var(--lb-muted-fg)] leading-relaxed",
        className,
      )}
    >
      {children}
    </p>
  );
}

export function AlertDialogFooter({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 p-4 sm:flex-row sm:justify-end",
        className,
      )}
    >
      {children}
    </div>
  );
}
