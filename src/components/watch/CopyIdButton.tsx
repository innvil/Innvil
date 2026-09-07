"use client";

import React, { useState } from "react";
import { Copy, Check } from "lucide-react";

/** Small accessible copy-to-clipboard button for a technical id (e.g. the
 *  numeric Telegram user id) — support/debugging convenience only, never the
 *  primary way a customer interacts with their identity. */
export function CopyIdButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can fail (permissions/insecure context) -- fail
      // silently rather than showing an error for a purely convenience action.
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      className="text-xs w-text-faint hover:w-text inline-flex items-center gap-1 rounded outline-none focus-visible:w-teal-border focus-visible:border"
    >
      {copied ? <Check size={12} className="w-green" /> : <Copy size={12} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
