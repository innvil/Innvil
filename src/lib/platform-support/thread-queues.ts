import type { PlatformSupportThread } from "@/src/lib/actions/platform-support";

export type InnvilSupportQueue = "responses" | "open" | "automated" | "addressed";

/**
 * Keep operational work distinct:
 * - owner-originated messages require an Innvil response;
 * - staff-originated messages remain open while awaiting the owner;
 * - automated welcomes are kept out of both operational queues until answered;
 * - resolved conversations return to the addressed inbox.
 */
export function innvilSupportQueue(thread: PlatformSupportThread): InnvilSupportQueue {
  if (thread.status === "resolved") return "addressed";
  if (thread.lastDirection === "inbound") return "responses";
  if (thread.originKind !== "general") return "automated";
  return "open";
}
