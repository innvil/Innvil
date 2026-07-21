import React from "react";
import { Gauge } from "lucide-react";

/**
 * DefaultLogo — the global default/placeholder brand mark: the original Ledgerline
 * "meter" (gauge) glyph in a gold rounded square. Used anywhere a panel/customer
 * hasn't set a custom logo, instead of a generic sparkle (which reads as an
 * AI-generated placeholder). This is a deliberate secondary brand asset.
 */
export function DefaultLogo({
  className = "w-8 h-8 rounded-lg",
  iconSize = 16,
}: {
  className?: string;
  iconSize?: number;
}) {
  return (
    <span className={`fp-gold-bg flex items-center justify-center shrink-0 ${className}`}>
      <Gauge size={iconSize} color="#0A0B0F" />
    </span>
  );
}

export function InnvilBrandMark({
  size,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size ?? "100%"}
      height={size ?? "100%"}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      preserveAspectRatio="xMidYMid meet"
      style={{ overflow: "visible" }}
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10 13H42L44 17L60 21L44 25L40 31V39L54 45V51H10V45L24 39V31L10 25V13Z"
      />
    </svg>
  );
}
