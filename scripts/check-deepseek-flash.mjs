// Manual, synthetic API smoke check. Never prints credentials or community data.
const model = "deepseek-flash";
const base = (process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com").replace(/\/+$/, "");
if (!["https://api.deepseek.com", "https://api.deepseek.com/v1"].includes(base)) {
  throw new Error("Smoke check requires the official DeepSeek API endpoint.");
}
const key = process.env.DEEPSEEK_API_KEY?.trim().replace(/^['"]|['"]$/g, "");
if (!key) throw new Error("DeepSeek API key is unavailable.");
const started = Date.now();
const response = await fetch(`${base}/chat/completions`, {
  method: "POST", signal: AbortSignal.timeout(30000),
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({ model, thinking: { type: "disabled" }, max_tokens: 32,
    messages: [{ role: "user", content: "Reply with only: hello" }] }),
});
if (!response.ok) throw new Error(`DeepSeek smoke check returned HTTP ${response.status}.`);
const result = await response.json();
const content = result.choices?.[0]?.message?.content;
const hasReasoning = !!result.choices?.[0]?.message?.reasoning_content;
console.log(JSON.stringify({ configuredModel: process.env.DEEPSEEK_CHATTER_MODEL ?? null,
  requestedModel: model, responseModel: result.model, status: response.status,
  hasContent: typeof content === "string" && content.trim().length > 0,
  hasReasoning, elapsedMs: Date.now() - started, totalTokens: result.usage?.total_tokens }));
if (typeof content !== "string" || !content.trim() || hasReasoning) process.exitCode = 1;
