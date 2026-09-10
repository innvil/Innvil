# Managed DeepSeek Flash routing

Verified against DeepSeek's official documentation on 2026-09-10:

- The API model name for DeepSeek V4.1 Flash is `deepseek-flash`.
- DeepSeek says the legacy `deepseek-v4-flash` and
  `deepseek-v4-flash-vision-exp` names temporarily route to V4.1 Flash too.
- Keep `https://api.deepseek.com` and the existing API key. Non-thinking mode
  still requires `thinking: { type: "disabled" }`.

Sources: [release notes](https://api-docs.deepseek.com/updates/),
[model mapping](https://api-docs.deepseek.com/quick_start/pricing/),
[thinking control](https://api-docs.deepseek.com/guides/thinking_mode/).

`deepseekChatterProvider()` defaults to `deepseek-flash`. An explicit
`DEEPSEEK_CHATTER_MODEL` environment setting takes precedence, so deployed
production/preview configuration must be updated as well as the source default.
This is the provider's current Flash alias, not an immutable version pin.

The shared managed route supplies casual chatter, solicitation/scam/negative
warning wording, media warnings, presence messages, conversational relevance
checks, and ambient reaction selection.
Substantive ANSWER routing and moderation classification retain their existing
primary-model routing. BYO accounts retain their own configured credentials/model.
No prompt, enforcement, cooldown, budget, or thinking-mode policy changes are
part of this model-name update. No migration is required.

Outgoing-request regression tests cover casual chatter and all three warning
generators, including the explicit non-thinking parameter. The full 2,489-test
suite and production build passed for this update. A live API smoke check was
attempted but could not run because the production secret was not retrievable
locally. This is not evidence of a live provider success or failure.

The optional `scripts/check-deepseek-flash.mjs` requires a separately available
DeepSeek key, uses synthetic input only, never sends Telegram messages, and
does not print keys. The production key was neither replaced nor exposed.
