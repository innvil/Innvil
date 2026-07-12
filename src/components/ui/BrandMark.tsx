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
