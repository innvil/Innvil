import { NextResponse } from "next/server";
import { forwardInboundEmail, type InboundEmailPayload } from "@/src/lib/email/resend";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asLooseString(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    return v.map((x) => asLooseString(x)).filter(Boolean).join("\n");
  }
  if (!v || typeof v !== "object") return "";
  const o = v as Record<string, unknown>;
  return (
    asLooseString(o.text) ||
    asLooseString(o.value) ||
    asLooseString(o.content) ||
    asLooseString(o.body) ||
    ""
  );
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v
      .map((x) => {
        if (typeof x === "string") return x;
        if (x && typeof x === "object") {
          const o = x as Record<string, unknown>;
          return asLooseString(o.email) || asLooseString(o.address) || asLooseString(o.value);
        }
        return String(x ?? "");
      })
      .map((x) => x.trim())
      .filter(Boolean);
  }
  if (typeof v === "string") return v.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  return [];
}

function pickEmailEvent(body: unknown): InboundEmailPayload | null {
  if (!body || typeof body !== "object") return null;
  const root = body as Record<string, unknown>;
  const data = (root.data && typeof root.data === "object") ? (root.data as Record<string, unknown>) : root;
  const headers = (data.headers && typeof data.headers === "object") ? (data.headers as Record<string, unknown>) : {};

  const from = asString(data.from) || asString(root.from) || asString(headers.from);
  const to = asStringArray(data.to).length
    ? asStringArray(data.to)
    : asStringArray(root.to).length
      ? asStringArray(root.to)
      : asStringArray(headers.to);
  const subject = asLooseString(data.subject) || asLooseString(root.subject) || asLooseString(headers.subject);
  const text =
    asLooseString(data.text) ||
    asLooseString(root.text) ||
    asLooseString(data.textBody) ||
    asLooseString(root.textBody) ||
    asLooseString(data.text_body) ||
    asLooseString(root.text_body) ||
    asLooseString((data as Record<string, unknown>).plainText) ||
    asLooseString((root as Record<string, unknown>).plainText);
  const html =
    asLooseString(data.html) ||
    asLooseString(root.html) ||
    asLooseString(data.htmlBody) ||
    asLooseString(root.htmlBody) ||
    asLooseString(data.html_body) ||
    asLooseString(root.html_body);
  const receivedAt = asString(data.created_at) || asString(root.created_at) || new Date().toISOString();

  if (!from || !to.length) return null;
  return { from, to, subject, text, html, receivedAt };
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const expectedToken = process.env.RESEND_INBOUND_TOKEN?.trim();
  const gotToken = url.searchParams.get("token") || req.headers.get("x-inbound-token") || "";
  if (expectedToken && gotToken !== expectedToken) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let parsed: unknown = null;
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON payload" }, { status: 400 });
  }

  const email = pickEmailEvent(parsed);
  if (!email) {
    return NextResponse.json({ ok: false, error: "No inbound email data found" }, { status: 400 });
  }

  const inboundAddress = (process.env.RESEND_INBOUND_ADDRESS?.trim() || "creat@innvil.cloud").toLowerCase();
  const isForConfiguredInbox = email.to.some((addr) => addr.toLowerCase() === inboundAddress);
  if (!isForConfiguredInbox) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Recipient does not match configured inbox" });
  }

  await forwardInboundEmail(email);
  return NextResponse.json({ ok: true });
}
