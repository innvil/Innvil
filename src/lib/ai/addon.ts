/**
 * AI add-on gate. AI features (customer support chat, owner assistant) only run
 * when a panel has the paid "AI Support" add-on enabled. The flag lives in
 * panels.settings.addons.ai_support.enabled. Pure/serializable — safe to import
 * server-side anywhere; the enabled boolean is passed to the client via props.
 */

export interface AiAddonState {
  enabled: boolean;
  enabledAt: string | null;
}

export function readAiAddon(settings: unknown): AiAddonState {
  if (settings && typeof settings === "object") {
    const addons = (settings as Record<string, unknown>).addons;
    if (addons && typeof addons === "object") {
      const ai = (addons as Record<string, unknown>).ai_support;
      if (ai && typeof ai === "object") {
        const o = ai as Record<string, unknown>;
        return {
          enabled: o.enabled === true,
          enabledAt: typeof o.enabledAt === "string" ? o.enabledAt : null,
        };
      }
    }
  }
  return { enabled: false, enabledAt: null };
}

export function aiSupportEnabled(settings: unknown): boolean {
  return readAiAddon(settings).enabled;
}

/* ---------------------------------------------------------------------------
   Owner AI Assistant add-on (paid, per-panel, $2.99/mo from the panel's Innvil
   balance). Subscription state lives in settings.addons.ai_assistant.
   --------------------------------------------------------------------------- */

export interface AiAssistantState {
  enabled: boolean;
  since: string | null;
  lastChargeAt: string | null;
  nextChargeAt: string | null;
  /** true when a scheduled charge failed for lack of balance (paused until funded). */
  lapsed: boolean;
}

export function readAiAssistant(settings: unknown): AiAssistantState {
  const off: AiAssistantState = { enabled: false, since: null, lastChargeAt: null, nextChargeAt: null, lapsed: false };
  if (settings && typeof settings === "object") {
    const addons = (settings as Record<string, unknown>).addons;
    if (addons && typeof addons === "object") {
      const a = (addons as Record<string, unknown>).ai_assistant;
      if (a && typeof a === "object") {
        const o = a as Record<string, unknown>;
        return {
          enabled: o.enabled === true,
          since: typeof o.since === "string" ? o.since : null,
          lastChargeAt: typeof o.lastChargeAt === "string" ? o.lastChargeAt : null,
          nextChargeAt: typeof o.nextChargeAt === "string" ? o.nextChargeAt : null,
          lapsed: o.lapsed === true,
        };
      }
    }
  }
  return off;
}

export function aiAssistantEnabled(settings: unknown): boolean {
  return readAiAssistant(settings).enabled;
}
