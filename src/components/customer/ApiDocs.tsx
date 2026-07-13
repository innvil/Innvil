"use client";

import React, { useState } from "react";
import { Copy, Check, Lock, KeyRound, CheckCircle2 } from "lucide-react";

/* =========================================================
   CUSTOMER API DOCS — one tab per endpoint, each with a
   request sample and a highlighted JSON response sample.
   ========================================================= */

const BASE_PLACEHOLDER = "__API_BASE__";

/** Mask an API key for display: nb_live_886c0ba9f8662839976f69bd
    → nb_live_886**********839976f69bd. Copy actions still use the full key. */
export function maskApiKey(key: string): string {
  if (key.length <= 22) return key;
  return key.slice(0, 11) + "*".repeat(key.length - 22) + key.slice(-11);
}

interface Endpoint {
  k: string;
  label: string;
  method: "GET" | "POST";
  desc: string;
  request: string;
  note?: string;
  response: string;
}

const ENDPOINTS: Endpoint[] = [
  {
    k: "services",
    label: "Service list",
    method: "GET",
    desc: "Use this method to get the full service list.",
    request: `${BASE_PLACEHOLDER}?action=services&key=YOUR_API_KEY`,
    response: `[
  {
    "service": 2101,
    "name": "Instagram Followers — HQ",
    "type": "default",
    "category": "Instagram — Followers",
    "rate": "1.35",
    "min": 100,
    "max": 100000,
    "refill": true,
    "cancel": true,
    "drip": true
  }
]`,
  },
  {
    k: "create",
    label: "Create",
    method: "POST",
    desc: "Use this method to create a new order.",
    request: `${BASE_PLACEHOLDER}?action=add&service=2101&link=https://instagram.com/you&quantity=5000&key=YOUR_API_KEY`,
    note: "For Custom Comments services, send comments as one comment per line. The app derives quantity from the comment count and forwards comments to the provider. Drip feed (only for services with \"drip\": true): append &runs=5&interval=30. Quantity is split across runs, never multiplied.",
    response: `{
  "order": 23501
}`,
  },
  {
    k: "status",
    label: "Status",
    method: "GET",
    desc: "Use this method to get the status of a single order.",
    request: `${BASE_PLACEHOLDER}?action=status&order=8841&key=YOUR_API_KEY`,
    response: `{
  "charge": "6.75",
  "start_count": 3572,
  "status": "Processing",
  "remains": 1220,
  "currency": "USD"
}`,
  },
  {
    k: "multistatus",
    label: "Multiple status",
    method: "GET",
    desc: "Use this method to get the status of up to 100 orders at once.",
    request: `${BASE_PLACEHOLDER}?action=status&orders=8841,8836,8811&key=YOUR_API_KEY`,
    response: `{
  "8841": {
    "charge": "6.75",
    "start_count": 3572,
    "status": "Completed",
    "remains": 0,
    "currency": "USD"
  },
  "8836": {
    "charge": "9.50",
    "start_count": 120400,
    "status": "Processing",
    "remains": 18300,
    "currency": "USD"
  },
  "8811": {
    "error": "Incorrect order ID"
  }
}`,
  },
  {
    k: "refill",
    label: "Refill",
    method: "POST",
    desc: "Use this method to request a refill for eligible orders.",
    request: `${BASE_PLACEHOLDER}?action=refill&order=8841&key=YOUR_API_KEY`,
    response: `{
  "refill": "1"
}`,
  },
  {
    k: "balance",
    label: "Balance",
    method: "GET",
    desc: "Use this method to get your current wallet balance.",
    request: `${BASE_PLACEHOLDER}?action=balance&key=YOUR_API_KEY`,
    response: `{
  "balance": "24.60",
  "currency": "USD"
}`,
  },
  {
    k: "cancel",
    label: "Cancel",
    method: "POST",
    desc: "Use this method to cancel orders that support cancellation.",
    request: `${BASE_PLACEHOLDER}?action=cancel&orders=8811,8812&key=YOUR_API_KEY`,
    response: `[
  {
    "order": 8811,
    "cancel": 1
  },
  {
    "order": 8812,
    "cancel": {
      "error": "Incorrect order ID"
    }
  }
]`,
  },
];

/** Lightweight JSON display highlighter — keys default, strings green,
    numbers violet, booleans/null gold. Display only, not a parser. */
function highlightJson(code: string): React.ReactNode[] {
  const regex = /("[^"]*")(\s*:)|("[^"]*")|(\btrue\b|\bfalse\b|\bnull\b)|(-?\d+(?:\.\d+)?)/g;
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = regex.exec(code)) !== null) {
    if (m.index > last) nodes.push(code.slice(last, m.index));
    if (m[1]) {
      nodes.push(<span key={i++} className="fp-text">{m[1]}</span>);
      nodes.push(m[2]);
    } else if (m[3]) {
      nodes.push(<span key={i++} className="fp-safe">{m[3]}</span>);
    } else if (m[4]) {
      nodes.push(<span key={i++} className="fp-gold">{m[4]}</span>);
    } else if (m[5]) {
      nodes.push(<span key={i++} className="fp-violet">{m[5]}</span>);
    }
    last = regex.lastIndex;
  }
  if (last < code.length) nodes.push(code.slice(last));
  return nodes;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — ignore */
    }
  };
  return (
    <button
      onClick={copy}
      className="shrink-0 fp-text-faint hover:fp-text transition-colors"
      title="Copy"
      aria-label="Copy to clipboard"
    >
      {copied ? <Check size={14} className="fp-safe" /> : <Copy size={14} />}
    </button>
  );
}

export function ApiDocs({
  apiBaseUrl,
  apiKey,
  inactive,
  enabled,
  hasExistingApiKey,
  onRegenerate,
  keyRegenerated,
}: {
  apiBaseUrl: string;
  apiKey: string | null;
  inactive: boolean;
  enabled: boolean;
  hasExistingApiKey: boolean;
  onRegenerate: () => void | Promise<void>;
  keyRegenerated: boolean;
}) {
  const [tab, setTab] = useState("services");
  const ep = ENDPOINTS.find((e) => e.k === tab) ?? ENDPOINTS[0];
  const requestSample = ep.request.replace(BASE_PLACEHOLDER, apiBaseUrl);

  return (
    <div className="space-y-5">
      {/* API key */}
      <div className="fp-panel border fp-line rounded-2xl p-6">
        <p className="fp-display text-lg mb-4">API access</p>
        <p className="fp-text-dim text-sm mb-3">
          Your personal API key — keep it secret. Generating a new key immediately
          invalidates the old one, so update any integrations that use it.
        </p>
        <div className="bg-[#131720] border border-[#1E212A] rounded-lg px-4 py-3 text-xs fp-mono mb-3">
          <span className="fp-text-faint">Base URL:</span> <span>{apiBaseUrl}</span>
        </div>
        <div className="bg-[#1B1E27] border border-[#1E212A] rounded-lg px-4 py-3 fp-mono text-sm flex items-center justify-between gap-3">
          <span className="truncate">{apiKey ? maskApiKey(apiKey) : hasExistingApiKey ? "API key exists (hidden). Generate new key to reveal." : "No API key generated yet"}</span>
          {apiKey && <CopyButton text={apiKey} />}
        </div>
        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={onRegenerate}
            disabled={!enabled}
            className="text-sm fp-gold border border-[rgba(201,165,116,0.35)] rounded-lg px-5 py-2.5 hover:fp-gold-soft-bg flex items-center gap-2 transition-colors"
          >
            <KeyRound size={14} /> {apiKey ? "Generate new key" : "Generate API key"}
          </button>
          {keyRegenerated && (
            <span className="text-xs fp-safe flex items-center gap-1">
              <CheckCircle2 size={12} /> New key generated
            </span>
          )}
        </div>
        {!enabled && (
          <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <p className="text-xs text-red-400">
              API access is disabled by this panel owner.
            </p>
          </div>
        )}
        {inactive && (
          <div className="mt-4 p-3 rounded-lg bg-[rgba(201,165,116,0.08)] border border-[rgba(201,165,116,0.2)]">
            <p className="text-xs fp-gold flex items-start gap-1.5">
              <Lock size={12} className="mt-0.5 shrink-0" />
              Order-submission endpoints (Create) currently return a &quot;panel inactive&quot;
              response. Status, balance, and service queries still work.
            </p>
          </div>
        )}
      </div>

      {/* Endpoint docs */}
      <div className="fp-panel border fp-line rounded-2xl p-6">
        <p className="fp-display text-lg mb-4">Endpoints</p>

        <div className="flex gap-1.5 flex-wrap mb-6">
          {ENDPOINTS.map((e) => (
            <button
              key={e.k}
              onClick={() => setTab(e.k)}
              className={`text-xs px-3.5 py-2 rounded-full transition-colors ${
                tab === e.k
                  ? "fp-violet-soft-bg fp-violet font-medium"
                  : "fp-panel-raised fp-text-dim hover:fp-text"
              }`}
            >
              {e.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2.5 mb-6">
          <span className="fp-mono text-[10px] fp-violet-soft-bg fp-violet px-2 py-1 rounded w-12 text-center shrink-0">
            {ep.method}
          </span>
          <p className="text-sm fp-text-dim">{ep.desc}</p>
        </div>

        <p className="fp-text-faint text-xs fp-mono uppercase tracking-wide mb-2">Request sample</p>
        <div className="bg-[#1B1E27] border border-[#1E212A] rounded-lg px-4 py-3 fp-mono text-xs flex items-center justify-between gap-3 mb-2 overflow-x-auto">
          <span className="whitespace-nowrap">{requestSample}</span>
          <CopyButton text={requestSample} />
        </div>
        {ep.note && (
          <p className="text-xs fp-text-dim mb-4 leading-relaxed">{ep.note}</p>
        )}

        <p className="fp-text-faint text-xs fp-mono uppercase tracking-wide mb-2 mt-5">Response sample</p>
        <div className="bg-[#1B1E27] border border-[#1E212A] rounded-lg px-4 py-3 relative">
          <div className="absolute top-3 right-3">
            <CopyButton text={ep.response} />
          </div>
          <pre className="fp-mono text-xs leading-relaxed overflow-x-auto fp-text-dim">
            {highlightJson(ep.response)}
          </pre>
        </div>
      </div>
    </div>
  );
}
