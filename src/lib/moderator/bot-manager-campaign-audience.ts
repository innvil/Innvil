/**
 * Pure, client-safe audience -> Telegram chat_type mapping for
 * innvil_bot_manager's marketing campaigns (Phase 4.Q). Extracted into its
 * own module (no `server-only`, no admin/Telegram imports) specifically so
 * the superadmin UI can compute a real eligible-chat-count preview without
 * pulling bot-manager-campaign-runtime.ts's whole server-only module graph
 * (createAdminClient/telegramApiCall) into the client bundle -- the exact
 * server/client boundary bug this codebase has hit before (see
 * watch-status.ts's own extraction history).
 */

export type CampaignTargetAudience = "all" | "private_users" | "groups" | "channels";

/** Real, already-known-to-us destinations for a campaign's audience --
 *  never a guess/invented chat id. `groups` includes both `group` and
 *  `supergroup` Telegram chat types (the same distinction Telegram itself
 *  draws between a small and a large group, irrelevant to a marketing
 *  audience selection). */
export function chatTypesForAudience(audience: CampaignTargetAudience): string[] | null {
  if (audience === "private_users") return ["private"];
  if (audience === "groups") return ["group", "supergroup"];
  if (audience === "channels") return ["channel"];
  return null; // "all" -- no chat_type filter
}
