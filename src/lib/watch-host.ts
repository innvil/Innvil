import "server-only";
import { headers } from "next/headers";
import { isWatchHostname } from "@/src/lib/config";

/**
 * True when the current request's host is Innvil Watch's own standalone
 * product domain (watch.innvil.cloud in Production), OR — Preview only —
 * this branch's one stable Vercel Preview alias (see
 * `isWatchHostname`/`WATCH_PREVIEW_ALIAS_HOST` in config.ts). Presentation-
 * only — deciding WHICH page/experience to render. Never used for
 * authorization; Watch product access is always resolved server-side from
 * the authenticated account (src/lib/products/ownership.ts
 * hasProductAccess), never inferred from hostname.
 */
export async function isWatchHost(): Promise<boolean> {
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(":")[0];
  return isWatchHostname(host);
}
