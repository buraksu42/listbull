import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Button — minimal variant-based button. We don't ship Radix Slot here;
 * if a caller needs link-as-button, use <a className={buttonClassName(...)}/>.
 *
 * Variants follow design.md: default = accent teal, secondary = muted-bg,
 * destructive = red, ghost = transparent.
 */
type ButtonVariant = "default" | "secondary" | "destructive" | "ghost" | "outline";
type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  default:
    "bg-[var(--lg-accent)] text-[var(--lg-accent-fg)] hover:opacity-90 active:opacity-80",
  secondary:
    "bg-[var(--lg-card)] text-[var(--lg-fg)] hover:bg-[var(--lg-muted)]",
  destructive:
    "bg-[var(--lg-destructive)] text-white hover:opacity-90 active:opacity-80",
  ghost:
    "bg-transparent text-[var(--lg-fg)] hover:bg-[var(--lg-muted)]",
  outline:
    "bg-transparent text-[var(--lg-fg)] border border-[var(--lg-border)] hover:bg-[var(--lg-muted)]",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-4 text-base",
  lg: "h-12 px-5 text-base",
  icon: "h-11 w-11 p-0",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "md", type = "button", ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-[var(--lg-r-md)] font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lg-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--lg-bg)]",
          "disabled:pointer-events-none disabled:opacity-50",
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
