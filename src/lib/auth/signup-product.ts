import { isTrustedWatchHost } from "@/src/lib/config";

/** Analytics only. This marker must never grant roles or product access. */
export function signupProductForHost(host: string): "watch" | "innvil" {
  return isTrustedWatchHost(host.trim().toLowerCase().split(":")[0]) ? "watch" : "innvil";
}
