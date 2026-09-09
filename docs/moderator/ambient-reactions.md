# Reaction-only participation — 2026-09-09

This adds an independent emoji-only path after safety moderation and the
Natural Chatter entitlement gate, before task routing or conversational replies.

- Short unambiguous congratulations from members/admins receive applause without
  a prior watcher exchange, including congratulations replying to another human.
- Verified admins' standalone longer updates receive bounded semantic review
  for applause, celebration, warmth/support or neutral acknowledgement. The
  requested mixed progress/testing-errors/tired-but-optimistic example can get
  a heart, without a text reply. It is not automatically celebrated by keyword.
- Admin text-ignore remains intact. The UI now calls this **Reply to admins/mods**
  and explicitly describes the separate reaction behavior.
- Questions, DM nudges, passive wishes, unknown roles, obvious harmful sentiment,
  commands and private admin replies do not enter this new path. A model NONE,
  malformed answer, non-verbatim evidence, missing credential or timeout never
  creates a reaction. Existing moderation owns deleted messages first.
- One stable reactor per message across all bots. No additional-reactor fan-out,
  generated text or delayed reply after an accepted reaction. Hearts/applause/
  celebration/neutral acknowledgement retain their meaning across personas.
- Telegram rejection is logged; an invalid emoji may retry once with thumbs-up,
  with the actual successful emoji recorded. Neither failure nor pacing causes
  a standalone emoji text message. Supported reaction types are documented by
  [Telegram](https://core.telegram.org/bots/api#reactiontypeemoji).

## Required migration and pacing

Apply `0131_watch_ambient_reactions.sql` before deploying. A service-only atomic
claim serializes reaction candidates across a community, deduplicates message
IDs, and bounds classification/reaction attempts: a 20-second member gap,
10-second admin gap, maximum 60 attempts/hour/community. Failed/declined attempts
also count, bounding model cost and retry storms. Claim records contain only
community/message IDs and timestamps; records older than two days are pruned
when that community next claims. Existing webhook deduplication still applies.
Without this migration, the new path fails closed and logs the missing claim;
it does not bypass pacing or send text instead of congratulations reactions.

## Costs and limitations

Congratulation recognition is a narrow English fast path; longer English
congratulations receive semantic review instead of automatic applause. Admin-update semantic
review supports other languages through the existing managed cheap-chat provider
or the account's BYO provider; BYO never falls back to a managed key. Maximum
160 output tokens, 6,000 input characters, at most 8 seconds caller budget reduced
by time already spent in moderation (5 seconds reserved for Telegram/logging), no escalation.
This reviews the current post, not unseen linked pages/images; it does not certify
links or create official memories. Existing classification telemetry conventions
are unchanged. Missing managed/BYO credentials mean no semantic update reaction.
Oversized messages, short ambiguous remarks and non-English member congratulations
may remain silent; there is no promise to react to every post. Model sentiment
accuracy still needs observation, not just successful orchestration tests.

## Verification

`ambient-reactions.test.ts` covers intent gates, strict semantic output validation,
stable single-reactor choice, persona preservation and provider boundaries.
`watcher-policy-runtime.test.ts` exercises the real handler with mocked Telegram,
database and model responses: no prior exchange, admin-ignore, progress heart,
declines/failures, missing claims, unknown roles, deleted spam and disabled chatter.
`scripts/test-ambient-reactions-migration.mjs` executes the real migration against
isolated PostgreSQL and checks role permissions, competing calls, duplicate IDs,
pacing, hourly ceiling, community isolation and retention. No live community
messages were used for testing.

Verification result: TypeScript, production build, both isolated PostgreSQL
migration fixtures and the full 2,476-test suite passed. Semantic model output
was mocked in orchestration tests; the local managed provider key is not
configured, so actual-model sentiment quality has not been live-validated.
Production environment metadata confirms DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL
and DEEPSEEK_CHATTER_MODEL are present; secret values were not retrieved. Their
presence alone does not validate API access, latency or sentiment quality.
