import * as React from "react";

import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          "flex h-11 w-full rounded-[var(--lb-r-md)] border border-[var(--lb-border)] bg-[var(--lb-input-bg)] px-3 py-2 text-base text-[var(--lb-fg)]",
          "placeholder:text-[var(--lb-muted-fg)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lb-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--lb-bg)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
