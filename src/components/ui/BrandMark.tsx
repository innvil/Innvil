import React from "react";

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
      aria-hidden="true"
    >
      <rect x="0" y="0" width="64" height="64" rx="18" fill="#11131A" />
      <path
        d="M18 19H46"
        stroke="#C9A574"
        strokeWidth="3.8"
        strokeLinecap="round"
      />
      <rect x="16" y="23" width="32" height="12" rx="3" stroke="#C9A574" strokeWidth="3.8" />
      <rect x="21" y="35" width="22" height="10" rx="2" fill="#C9A574" />
      <path d="M20 23V19" stroke="#C9A574" strokeWidth="3.8" strokeLinecap="round" />
      <path d="M44 23V19" stroke="#C9A574" strokeWidth="3.8" strokeLinecap="round" />
      <path d="M29 13V9" stroke="#C9A574" strokeWidth="3.8" strokeLinecap="round" />
      <path d="M35 16L41 10" stroke="#C9A574" strokeWidth="3" strokeLinecap="round" />
      <path d="M18 45L12 50" stroke="#C9A574" strokeWidth="3" strokeLinecap="round" />
      <path d="M46 45L52 50" stroke="#C9A574" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
