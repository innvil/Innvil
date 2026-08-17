import "server-only";
import { headers } from "next/headers";
import { WATCH_ROOT_DOMAIN } from "@/src/lib/config";

/**
 * True when the current request's host is Innvil Watch's own standalone
 * product domain (watch.innvil.cloud). Presentation-only — deciding WHICH
 * page/experience to render. Never used for authorization; Watch product
 * access is always resolved server-side from the authenticated account
 * (src/lib/products/ownership.ts hasProductAccess), never inferred from
 * hostname.
 */
export async function isWatchHost(): Promise<boolean> {
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").toLowerCase().split(":")[0];
  return host === WATCH_ROOT_DOMAIN.toLowerCase();
}
