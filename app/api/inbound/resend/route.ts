import { NextResponse } from "next/server";
import { forwardInboundEmail } from "@/src/lib/email/resend";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type ResendReceivedEvent = {
  type: "email.received";
  data: {
    email_id: string;
    from: string;
    to: string[];
    received_for?: string[];
    subject?: string;
    created_at?: string;
  };
};

function isResendReceivedEvent(value: unknown): value is ResendReceivedEvent {
  if (!value || typeof value !== "object") return false;

  const event = value as Partial<ResendReceivedEvent>;
  const data = event.data;

  return (
    event.type === "email.received" &&
    !!data &&
    typeof data.email_id === "string" &&
    typeof data.from === "string" &&
    Array.isArray(data.to)
  );
}

export async function POST(req: Request) {
  const url = new URL(req.url);

  const expectedToken = process.env.RESEND_INBOUND_TOKEN?.trim();
  const receivedToken =
    url.searchParams.get("token") ?? req.headers.get("x-inbound-token") ?? "";

  if (expectedToken && receivedToken !== expectedToken) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let event: unknown;
  try {
    event = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON payload" }, { status: 400 });
  }

  if (!isResendReceivedEvent(event)) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "Not an email.received event",
    });
  }

  const inboundAddress = (process.env.RESEND_INBOUND_ADDRESS?.trim() || "create@innvil.cloud").toLowerCase();

  const recipients = [...event.data.to, ...(event.data.received_for ?? [])].map((address) =>
    address.toLowerCase()
  );

  if (!recipients.includes(inboundAddress)) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "Recipient does not match configured inbox",
    });
  }

  try {
    await forwardInboundEmail({
      emailId: event.data.email_id,
      subject: event.data.subject ?? "(No subject)",
      from: event.data.from,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Inbound forwarding failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Inbound forwarding failed",
      },
      { status: 500 }
    );
  }
}
