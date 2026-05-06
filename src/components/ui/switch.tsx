"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Switch — accessible toggle backed by a hidden checkbox so it works with
 * native form submission, react-hook-form, and screen readers without extra ARIA.
 */
export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
  className?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  id,
  ariaLabel,
  className,
}: SwitchProps) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors",
        "focus-within:outline-none focus-within:ring-2 focus-within:ring-[var(--lb-accent)] focus-within:ring-offset-2 focus-within:ring-offset-[var(--lb-bg)]",
        disabled && "cursor-not-allowed opacity-50",
        checked
          ? "bg-[var(--lb-accent)]"
          : "bg-[var(--lb-border)]",
        className,
      )}
    >
      <input
        id={id}
        type="checkbox"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onCheckedChange(e.target.checked)}
        className="sr-only"
      />
      <span
        aria-hidden
        className={cn(
          "inline-block h-5 w-5 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </label>
  );
}
