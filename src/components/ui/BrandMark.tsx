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
        d="M8.5 20.5H35.5Q38.5 20.5 41.5 19.5Q43.8 18.4 46 16.2L49 14H54L50.8 21H55.5V27H43.5V33Q43.5 35 44.8 36.4L47.8 39.8H52V44.8H7V39.8H11.4L14.6 36.3Q16 34.9 16 33V27H6.5V21H8.5V20.5Z"
      />
    </svg>
  );
}
