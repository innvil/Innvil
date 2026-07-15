import "server-only";

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

export interface InboundEmailPayload {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
  receivedAt: string;
}

/**
 * Forwards an inbound email to a configured mailbox (e.g., Gmail).
 * Required env:
 * - RESEND_FORWARD_TO (destination mailbox)
 */
export async function forwardInboundEmail(payload: InboundEmailPayload): Promise<void> {
  const forwardTo = process.env.RESEND_FORWARD_TO?.trim();
  const from = process.env.RESEND_FORWARD_FROM?.trim() || "Innvil Inbox <noreply@innvil.cloud>";
  const key = process.env.RESEND_API_KEY?.trim();
  if (!forwardTo || !key) return;

  const escapedText = (v: string) =>
    v
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const htmlToText = (html: string): string =>
    html
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<\s*br\s*\/?\s*>/gi, "\n")
      .replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li|tr|td)\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\r/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();

  const plainBody =
    payload.text?.trim() ||
    htmlToText(payload.html || "") ||
    "(No readable body was provided by the sender.)";

  const htmlBody = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:720px;margin:0 auto;padding:20px;color:#1f2937">
    <h2 style="margin:0 0 14px;font-size:18px;color:#111827">Forwarded inbound email</h2>
    <p style="margin:0 0 6px"><strong>From:</strong> ${escapedText(payload.from)}</p>
    <p style="margin:0 0 6px"><strong>To:</strong> ${escapedText(payload.to.join(", "))}</p>
    <p style="margin:0 0 6px"><strong>Received:</strong> ${escapedText(payload.receivedAt)}</p>
    <p style="margin:0 0 16px"><strong>Subject:</strong> ${escapedText(payload.subject || "(no subject)")}</p>
    <div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px;background:#fafafa">
      <pre style="white-space:pre-wrap;margin:0;font-family:ui-monospace,Menlo,Consolas,monospace;color:#1f2937">${escapedText(plainBody)}</pre>
    </div>
  </div>`;

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: forwardTo,
        subject: `[Forwarded] ${payload.subject || "(no subject)"}`,
        html: htmlBody,
        text: `Forwarded inbound email\n\nFrom: ${payload.from}\nTo: ${payload.to.join(", ")}\nReceived: ${payload.receivedAt}\nSubject: ${payload.subject || "(no subject)"}\n\n${plainBody}`,
        reply_to: payload.from || undefined,
      }),
      cache: "no-store",
    });
  } catch {
    // best-effort — never throw
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
