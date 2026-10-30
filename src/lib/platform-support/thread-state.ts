export type SupportDirection = "inbound" | "outbound";

/** A message only notifies its recipient, never its sender. */
export function unreadStateForDirection(direction: SupportDirection) {
  return {
    ownerUnread: direction === "outbound",
    innvilUnread: direction === "inbound",
  };
}

/** Email is deliberately alert-only; support content stays in the Innvil panel. */
export function supportEmailAlert(recipient: "owner" | "innvil") {
  return recipient === "innvil"
    ? "A panel owner sent a message. Open Innvil to read and reply in the conversation."
    : "Innvil replied to your support conversation. Sign in to read and reply there.";
}
