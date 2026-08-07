import { handleTelegramModeratorUpdate } from "@/src/lib/moderator/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  const raw = await req.text();
  return handleTelegramModeratorUpdate(raw, req.headers);
}