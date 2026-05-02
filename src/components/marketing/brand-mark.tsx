/**
 * Inline SVG of the listbull chat-bubble + checkmark mark.
 *
 * Source: `handoff/brand/listbull-mark.svg`. Inlined as a React component
 * (rather than `<img src=".svg">`) so it inherits `currentColor` for the
 * stroke check when used on a colored background, and so we ship zero
 * extra HTTP requests for the most-rendered asset on the marketing page.
 *
 * The bubble fill stays brand teal `#00D9C0` regardless of theme — the
 * mark is the brand's anchor, not a UI accent.
 */
import * as React from "react";

type BrandMarkProps = {
  size?: number;
  className?: string;
  ariaLabel?: string;
};

export function BrandMark({
  size = 56,
  className,
  ariaLabel = "listbull",
}: BrandMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={ariaLabel}
    >
      <path
        d="M28 14 L72 14 C82 14 90 22 90 32 L90 60 C90 70 82 78 72 78 L40 78 L26 90 L28 76 C20 73 14 66 14 58 L14 32 C14 22 22 14 28 14 Z"
        fill="#00D9C0"
      />
      <path
        d="M34 46 L44 56 L64 34"
        stroke="#0A1419"
        strokeWidth={8}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
