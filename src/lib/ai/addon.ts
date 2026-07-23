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
