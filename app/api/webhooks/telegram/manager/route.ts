import { handleManagerWebhook } from "@/src/lib/moderator/manager-webhook";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Innvil Telegram Manager Bot's own webhook — control plane only. Point the
 *  Manager Bot's setWebhook at this URL with TELEGRAM_MANAGER_WEBHOOK_SECRET. */
export async function POST(req: Request) {
  const raw = await req.text();
  return handleManagerWebhook(raw, req.headers);
}
