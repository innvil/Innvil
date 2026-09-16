import type { CommunitySender } from "./event-types";

/** Platform identity only: never infer a bot from names, text or forwards. */
export function isExternalBotCleanupCandidate(input: {
  enabled: boolean | null | undefined;
  claimed: boolean;
  chatType: string | undefined;
  hasSenderChat: boolean;
  sender: CommunitySender;
  receivingBotId: number | null;
}): boolean {
  return input.enabled === true && input.claimed
    && (input.chatType === "group" || input.chatType === "supergroup")
    && !input.hasSenderChat && input.sender.isBot === true
    && input.sender.senderType === "EXTERNAL_BOT"
    && /^[1-9][0-9]*$/.test(input.sender.platformUserId)
    && input.sender.platformUserId !== String(input.receivingBotId);
}
