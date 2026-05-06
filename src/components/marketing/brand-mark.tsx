/**
 * Inline SVG of the listbull mark — bull head silhouette with check-mark horns.
 *
 * Source: `handoff/brand/svg/listbull-mark.svg`. Direction B (revised):
 *   - Teal `#00D9C0` bull head
 *   - Cobalt `#3D7DFF` two-stroke check-mark horns
 *   - Subtle ink eyes for depth
 *
 * Inlined as a React component (rather than `<img src=".svg">`) so it ships
 * zero extra HTTP requests on the most-rendered asset of the marketing page.
 *
 * The brand colors stay constant regardless of theme — the mark is the
 * brand's anchor, not a UI accent.
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
      {/* Bull head — teal */}
      <path
        d="M50 34 C60 34 68 38 72 46 C74 52 74 58 72 64 C68 76 60 84 50 84 C40 84 32 76 28 64 C26 58 26 52 28 46 C32 38 40 34 50 34 Z"
        fill="#00D9C0"
      />
      {/* Left horn — cobalt check-mark stroke */}
      <path
        d="M16 22 L26 32 L42 8"
        stroke="#3D7DFF"
        strokeWidth={8}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Right horn — cobalt check-mark stroke */}
      <path
        d="M84 22 L74 32 L58 8"
        stroke="#3D7DFF"
        strokeWidth={8}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Eyes — subtle ink dots for depth */}
      <circle cx={44} cy={68} r={1.8} fill="#0A1419" opacity={0.55} />
      <circle cx={56} cy={68} r={1.8} fill="#0A1419" opacity={0.55} />
    </svg>
  );
}
