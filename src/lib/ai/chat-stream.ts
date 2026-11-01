/**
 * Client-side chat transport. Lets a chat widget stream a reply from a route when
 * the provider supports SSE, or fall back to a non-streaming server action when it
 * doesn't — chosen by a single env flag so switching providers is config-only.
 *
 * Enable streaming (only on a provider that supports it, e.g. Anthropic direct or
 * OpenRouter — NOT the aiprimetech proxy):  NEXT_PUBLIC_AI_STREAMING=true
 * (NEXT_PUBLIC_* is inlined at build time, so a redeploy applies the change — which
 * you're doing anyway when you switch providers.)
 */
export const AI_STREAMING = process.env.NEXT_PUBLIC_AI_STREAMING === "true";

/**
 * POST to a streaming AI route and invoke `onDelta` with the growing text as chunks
 * arrive. Throws with a useful message on error (surfaced by the caller in the chat).
 */
export async function streamAiReply(
  url: string,
  body: unknown,
  onDelta: (full: string) => void
): Promise<void> {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok || !resp.body) {
    const err = await resp.json().catch(() => ({ error: "Something went wrong." }));
    throw new Error(err.error ?? "Something went wrong.");
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let acc = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    acc += decoder.decode(value, { stream: true });
    onDelta(acc);
  }
  if (!acc.trim()) throw new Error("No response — please try again.");
}
