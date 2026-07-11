import { handleGatewayWebhook } from "@/src/lib/payments/webhook-handler";

/* Cryptomus IPN. Kept at its own static path for back-compat with deposits already
   created with this callback URL; the logic is the shared adapter handler. */

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  return handleGatewayWebhook(req, "cryptomus");
}
