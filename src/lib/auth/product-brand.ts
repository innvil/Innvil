import "server-only";
import type { Metadata } from "next";
import { isWatchHost } from "@/src/lib/watch-host";
import { watchPageMetadata } from "@/src/lib/watch-metadata";

/**
 * Product-aware auth presentation. This is presentation ONLY — every brand
 * shares the exact same Supabase Auth backend, `profiles` row, session
 * mechanism, and server actions (`src/lib/actions/auth.ts`). Signing in
 * through Watch authenticates the SAME Innvil account as signing in through
 * the main site; there is no separate Watch user/password/session system.
 *
 * Adding a future sibling product (e.g. Herald) means adding one entry here
 * and a matching host check — never a parallel "if (watch) ... else ..."
 * scattered through every auth page.
 */
export type AuthProductId = "innvil" | "watch";

export interface AuthBrand {
  id: AuthProductId;
  /** Wordmark shown next to the logo in the auth header. */
  name: string;
  /** Small line under the wordmark, or null for none. */
  eyebrow: string | null;
  /** Path to a static logo asset; null means "render the default Innvil mark". */
  logoSrc: string | null;
  /** Root theme wrapper classes (design-token scope + background treatment). */
  rootClass: string;
  panelClass: string;
  displayClass: string;
  monoClass: string;
  textDimClass: string;
  textFaintClass: string;
  accentTextClass: string;
  inputClass: string;
  btnClass: string;
  iconSoftBgClass: string;
  iconAccentClass: string;
  successSoftBgClass: string;
  successAccentClass: string;
  /** Where the header/logo link goes -- always "/" (host-aware: "/" already
   *  renders the right product experience for whatever host the visitor is on). */
  homeHref: string;
}

const INNVIL_BRAND: AuthBrand = {
  id: "innvil",
  name: "Innvil",
  eyebrow: null,
  logoSrc: null,
  rootClass: "fp-root min-h-screen fp-noise fp-grid-bg",
  panelClass: "fp-panel border fp-line rounded-2xl",
  displayClass: "fp-display",
  monoClass: "fp-mono",
  textDimClass: "fp-text-dim",
  textFaintClass: "fp-text-faint",
  accentTextClass: "fp-gold",
  inputClass: "w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5 text-sm mt-2 outline-none focus:fp-gold-border",
  btnClass: "fp-btn-primary font-semibold w-full py-2.5 rounded-lg text-sm flex items-center justify-center gap-2 mt-5 disabled:opacity-60",
  iconSoftBgClass: "fp-gold-soft-bg",
  iconAccentClass: "fp-gold",
  successSoftBgClass: "fp-safe-soft-bg",
  successAccentClass: "fp-safe",
  homeHref: "/",
};

const WATCH_BRAND: AuthBrand = {
  id: "watch",
  name: "Innvil Watch",
  eyebrow: "by Innvil",
  logoSrc: "/watch/app-tile.svg",
  rootClass: "watch-root min-h-screen",
  panelClass: "w-card",
  displayClass: "w-display",
  monoClass: "w-mono",
  textDimClass: "w-text-dim",
  textFaintClass: "w-text-faint",
  accentTextClass: "w-teal",
  inputClass: "w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2.5 text-sm mt-2 outline-none focus:w-teal-border",
  btnClass: "w-btn-primary font-semibold w-full py-2.5 rounded-lg text-sm flex items-center justify-center gap-2 mt-5 disabled:opacity-60",
  iconSoftBgClass: "w-teal-soft-bg",
  iconAccentClass: "w-teal",
  successSoftBgClass: "w-green-soft-bg",
  successAccentClass: "w-green",
  homeHref: "/",
};

export function resolveAuthBrand(isWatch: boolean): AuthBrand {
  return isWatch ? WATCH_BRAND : INNVIL_BRAND;
}

/** Canonical resolver: reads the actual request host and returns which
 *  product's auth presentation this request should render. Never used for
 *  authorization -- entitlement is always resolved separately, server-side,
 *  from the authenticated account (src/lib/products/ownership.ts). */
export async function getAuthProductContext(): Promise<{ isWatch: boolean; brand: AuthBrand }> {
  const isWatch = await isWatchHost();
  return { isWatch, brand: resolveAuthBrand(isWatch) };
}

/**
 * Full `generateMetadata()` return value for a shared auth page (login/
 * signup/forgot-password/reset-password), host-aware. Centralized here so
 * every auth page changes ONE call site instead of hand-writing its own
 * title/description/openGraph/twitter — the exact per-route duplication
 * that previously let the Watch auth pages silently inherit the root
 * layout's generic SMM-panel copy (they only ever set `icons`). On the
 * main Innvil brand this returns exactly what it always did (icons only,
 * since `logoSrc` is null there) — no change to non-Watch behavior.
 */
export function authPageMetadata(brand: AuthBrand, path: string): Metadata {
  const icons = brand.logoSrc ? { icons: { icon: brand.logoSrc } } : {};
  if (brand.id !== "watch") return icons;
  return { ...icons, ...watchPageMetadata(path) };
}
