import { NextResponse } from "next/server";
import { forwardInboundEmail, type InboundEmailPayload } from "@/src/lib/email/resend";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
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
  const subject = asString(data.subject) || asString(root.subject) || asString(headers.subject);
  const text = asString(data.text) || asString(root.text) || asString(data.textBody) || asString(root.textBody);
  const html = asString(data.html) || asString(root.html) || asString(data.htmlBody) || asString(root.htmlBody);
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
