import "server-only";
import { Resend } from "resend";

/**
 * Minimal Resend email sender. BEST-EFFORT and fire-and-forget: if RESEND_API_KEY
 * isn't set (or the call fails), it silently no-ops so it never blocks or breaks a
 * user action. Set RESEND_API_KEY and (optionally) RESEND_FROM in the environment.
 */
export async function sendEmail(opts: {
  to: string | null | undefined;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string | null;
}): Promise<void> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM?.trim() || "Innvil <noreply@innvil.cloud>";
  if (!key || !opts.to) return;
  try {
    const payload: Record<string, unknown> = {
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    };
    if (opts.text) payload.text = opts.text;
    if (opts.replyTo) payload.reply_to = opts.replyTo;

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch {
    // best-effort — never throw
  }
}

type ForwardInboundEmailInput = {
  emailId: string;
  subject: string;
  from: string;
};

/**
 * Forwards an inbound email using Resend's receiving.forward helper.
 */
export async function forwardInboundEmail({ emailId }: ForwardInboundEmailInput): Promise<void> {
  const key = process.env.RESEND_API_KEY?.trim();
  const destination = process.env.RESEND_FORWARD_TO?.trim();
  if (!key) throw new Error("RESEND_API_KEY is not configured");
  if (!destination) throw new Error("RESEND_FORWARD_TO is not configured");

  const resend = new Resend(key);
  const { error } = await resend.emails.receiving.forward({
    emailId,
    from: process.env.RESEND_FORWARD_FROM?.trim() || "Innvil Inbox <noreply@innvil.cloud>",
    to: destination,
  });

  if (error) {
    console.error("Resend forward error:", { emailId, error });
    throw new Error(error.message || "Failed to forward inbound email");
  }
}

/** Tiny helper to wrap plain text as a simple branded HTML email body. */
export function simpleEmail(heading: string, lines: string[], cta?: { label: string; url: string }): string {
  const body = lines.map((l) => `<p style="margin:0 0 12px;color:#3f3f46;font-size:14px;line-height:1.6">${l}</p>`).join("");
  const button = cta
    ? `<a href="${cta.url}" style="display:inline-block;margin-top:8px;background:#0E1522;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px">${cta.label}</a>`
    : "";
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px">
    <h2 style="font-size:18px;color:#0E1522;margin:0 0 16px">${heading}</h2>
    ${body}${button}
  </div>`;
}
