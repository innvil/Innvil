import "server-only";
import { aiComplete, deepseekChatterProvider } from "@/src/lib/ai/client";
import { byoProviderOverride, type AccountAiRouting } from "@/src/lib/products/watch-runtime";
import { AMBIENT_REACTION_SYSTEM, parseAmbientReaction, type AmbientReaction } from "./ambient-reactions";

/** Cheap semantic selection, no generation, escalation or managed-key fallback for BYO. */
export async function classifyAmbientReaction(text: string, routing: AccountAiRouting): Promise<AmbientReaction | null> {
  try {
    const credential = routing.required ? routing.credential : null;
    if (routing.required && (!credential || !credential.model)) return null;
    const managed = routing.required ? null : deepseekChatterProvider();
    if (!credential && !managed) return null;
    const raw = await aiComplete({
      system: AMBIENT_REACTION_SYSTEM, messages: [{ role: "user", content: JSON.stringify({ communityMessage: text }) }],
      model: credential ? credential.model! : managed!.model,
      providerOverride: credential ? byoProviderOverride(credential) : { provider: managed!.provider, apiKey: managed!.apiKey, baseUrl: managed!.baseUrl },
      disableThinking: true, maxTokens: 160, automation: "AMBIENT_REACTION_CLASSIFY",
    });
    return parseAmbientReaction(raw, text);
  } catch { return null; }
}
