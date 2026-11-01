import { handlePlatformWebhook } from "@/src/lib/payments/platform";

/* Owner→Innvil top-up webhook (Cryptomus/NOWPayments at the platform level).
   Credits panels.settings.innvil_balance. Separate from the per-panel customer
   deposit webhook at /api/webhooks/[gateway]. */

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request, { params }: { params: Promise<{ gateway: string }> }) {
  const { gateway } = await params;
  return handlePlatformWebhook(req, gateway);
}
