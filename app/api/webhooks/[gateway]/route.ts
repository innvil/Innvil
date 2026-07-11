import { handleGatewayWebhook } from "@/src/lib/payments/webhook-handler";

/* Dynamic gateway webhook (razorpay, stripe, …). Cryptomus keeps its own static
   route (below) for back-compat; static segments win over this dynamic one. */

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request, { params }: { params: Promise<{ gateway: string }> }) {
  const { gateway } = await params;
  return handleGatewayWebhook(req, gateway);
}
