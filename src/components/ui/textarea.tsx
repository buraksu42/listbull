import * as React from "react";

import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, rows = 4, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={cn(
          "flex w-full rounded-[var(--lb-r-md)] border border-[var(--lb-border)] bg-[var(--lb-input-bg)] px-3 py-2 text-base text-[var(--lb-fg)]",
          "placeholder:text-[var(--lb-muted-fg)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lb-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--lb-bg)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "resize-y min-h-[88px]",
          className,
        )}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";
