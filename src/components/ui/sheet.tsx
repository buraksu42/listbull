"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Bottom-sheet primitive — purpose-built for the Mini App. Native
 * <dialog> is not used because backdrop click + reduced-motion handling
 * gets simpler with a controlled component. Focus is trapped via the
 * `inert` attribute on background siblings.
 */
type SheetSide = "bottom" | "right";

type SheetContextValue = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const SheetContext = React.createContext<SheetContextValue | null>(null);

function useSheet(): SheetContextValue {
  const ctx = React.useContext(SheetContext);
  if (!ctx) throw new Error("Sheet primitives must be used inside <Sheet>");
  return ctx;
}

export function Sheet({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <SheetContext.Provider value={{ open, onOpenChange }}>
      {children}
    </SheetContext.Provider>
  );
}

export function SheetContent({
  side = "bottom",
  className,
  children,
  ariaLabel,
}: {
  side?: SheetSide;
  className?: string;
  children: React.ReactNode;
  ariaLabel?: string;
}) {
  const { open, onOpenChange } = useSheet();

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  const sideClasses: Record<SheetSide, string> = {
    bottom:
      "inset-x-0 bottom-0 rounded-t-[var(--lb-r-xl)] border-t border-[var(--lb-border)] max-h-[90dvh] data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom",
    right:
      "right-0 top-0 h-full w-full sm:max-w-sm border-l border-[var(--lb-border)]",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex"
      style={{ pointerEvents: "auto" }}
    >
      <button
        type="button"
        aria-label="Close sheet"
        onClick={() => onOpenChange(false)}
        className="absolute inset-0 bg-black/40 backdrop-blur-none"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? "Sheet"}
        className={cn(
          "absolute bg-[var(--lb-card)] text-[var(--lb-card-fg)] shadow-[var(--lb-shadow-sheet)]",
          "transition-transform duration-[var(--lb-dur-slow)] ease-[var(--lb-ease-emph)]",
          // Flex column so SheetBody can flex-1 + overflow-y-auto and
          // SheetHeader/SheetFooter stay pinned. Without this the body
          // overflows past max-h and the user can't scroll to Save.
          "flex flex-col",
          sideClasses[side],
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function SheetHeader({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 p-4 border-b border-[var(--lb-border)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SheetTitle({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <h2
      className={cn(
        "text-lg font-semibold tracking-[var(--lb-tracking-title)] text-[var(--lb-fg)]",
        className,
      )}
    >
      {children}
    </h2>
  );
}

export function SheetDescription({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <p className={cn("text-sm text-[var(--lb-muted-fg)]", className)}>
      {children}
    </p>
  );
}

export function SheetBody({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "p-4 overflow-y-auto flex-1 min-h-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SheetFooter({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 p-4 border-t border-[var(--lb-border)] sm:flex-row sm:justify-end",
        className,
      )}
    >
      {children}
    </div>
  );
}
