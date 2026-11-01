/**
 * Automated welcome message for new customers (per panel).
 *
 * When a customer creates an account on a storefront, we auto-open a support ticket
 * FROM the owner with a friendly welcome. The default copy offers a small free credit
 * (claimed by replying — granted once) and invites them to Innvil. Owners can edit the
 * subject/body entirely or turn the whole thing off. Config lives in
 * panels.settings.welcome (JSONB). Pure/serializable — safe on client or server.
 */

import { formatMoney } from "@/src/lib/money";

export interface WelcomeConfig {
  enabled: boolean;
  /** Subject template ({panel} placeholder supported). null = default. */
  subject: string | null;
  /** Body template ({panel}, {credit} placeholders supported). null = default. */
  body: string | null;
  /** Grant the free credit when the customer replies to the welcome ticket. */
  creditEnabled: boolean;
  /** Amount of free credit granted on first reply. */
  creditAmount: number;
}

export const DEFAULT_WELCOME_SUBJECT = "Welcome to {panel}! 🎉";

export const DEFAULT_WELCOME_BODY = `Hey there, and welcome to {panel}! 🎉

We're really glad to have you. Getting started is easy — add funds to your wallet, pick a service, and place your first order.

🎁 As a thank-you for joining, just reply to this message and we'll add {credit} of free credit to your wallet so you can try us out.

Got a question about anything? Reply right here — we're happy to help.

PS — Interested in running your own SMM panel like this one? You can build and manage your own white-label panel with Innvil (https://innvil.cloud) — no monthly rent, just a small commission on completed orders.`;

export const DEFAULT_WELCOME: WelcomeConfig = {
  enabled: true,
  subject: null,
  body: null,
  creditEnabled: true,
  creditAmount: 1,
};

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function readWelcomeConfig(settings: unknown): WelcomeConfig {
  if (settings && typeof settings === "object") {
    const w = (settings as Record<string, unknown>).welcome;
    if (w && typeof w === "object") {
      const o = w as Record<string, unknown>;
      return {
        enabled: o.enabled !== false,
        subject: typeof o.subject === "string" && o.subject.trim() ? o.subject.slice(0, 200) : null,
        body: typeof o.body === "string" && o.body.trim() ? o.body.slice(0, 4000) : null,
        creditEnabled: o.creditEnabled !== false,
        creditAmount: num(o.creditAmount, 1),
      };
    }
  }
  return { ...DEFAULT_WELCOME };
}

/** Clamp/sanitize owner-supplied config before persisting. */
export function normalizeWelcomeConfig(input: Partial<WelcomeConfig>): WelcomeConfig {
  return {
    enabled: input.enabled !== false,
    subject: typeof input.subject === "string" && input.subject.trim() ? input.subject.trim().slice(0, 200) : null,
    body: typeof input.body === "string" && input.body.trim() ? input.body.trim().slice(0, 4000) : null,
    creditEnabled: input.creditEnabled !== false,
    creditAmount: Math.min(num(input.creditAmount, 1), 1000),
  };
}

/** The effective template text (owner override, else default) — placeholders intact. */
export function welcomeSubjectTemplate(cfg: WelcomeConfig): string {
  return cfg.subject ?? DEFAULT_WELCOME_SUBJECT;
}
export function welcomeBodyTemplate(cfg: WelcomeConfig): string {
  return cfg.body ?? DEFAULT_WELCOME_BODY;
}

/** Fill {panel} / {credit} placeholders for the actual message sent. */
export function renderWelcome(
  cfg: WelcomeConfig,
  ctx: { panelName: string; currency: string }
): { subject: string; body: string } {
  const credit = formatMoney(cfg.creditAmount, ctx.currency);
  const fill = (t: string) => t.split("{panel}").join(ctx.panelName).split("{credit}").join(credit);
  return {
    subject: fill(welcomeSubjectTemplate(cfg)).slice(0, 200),
    body: fill(welcomeBodyTemplate(cfg)),
  };
}
