import { handleCommunityWebhook } from "@/src/lib/moderator/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** One webhook per subscriber-owned Telegram bot (community runtime events).
 *  Registered automatically when the bot is created/connected — see
 *  src/lib/moderator/manager.ts setIntegrationWebhook. */
export async function POST(req: Request, { params }: { params: Promise<{ integrationId: string }> }) {
  const { integrationId } = await params;
  const raw = await req.text();
  return handleCommunityWebhook(integrationId, raw, req.headers);
}
