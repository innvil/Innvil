-- Media Moderation Units expansion packs -- a real, one-time CURRENT-PERIOD
-- top-up, deliberately NOT built on the existing watch_subscription_addons
-- table (migration 0083/0087). That table enforces at most one ACTIVE row
-- per (account_id, addon_type) and models a RECURRING subscription add-on
-- (renews with the base subscription, cancel_at_period_end semantics) --
-- neither property fits this feature: a customer must be able to buy
-- MULTIPLE, differently-sized packs that all stack within the same period
-- (e.g. +1,000 today and +5,000 next week), and each purchase should only
-- ever cover the period it was bought in, never silently become a permanent
-- recurring capacity increase. This is the smallest safe architecture for
-- that shape -- one row per purchase, scoped by (account_id, period_start),
-- summed at read time. See watch-media-moderation-expansion.ts.
--
-- Scoped to direct-Watch accounts only (account_id, no panel_id), same as
-- watch_media_moderation_usage (0091) -- this is a Watch-only concept.
--
-- period_start/period_end mirror the account's real current Watch
-- subscription period at the moment of purchase (resolveAccountBillingPeriod,
-- watch-ai-usage.ts) -- when the period rolls over to a new period_start on
-- renewal, previously-purchased rows tied to the OLD period_start simply stop
-- being summed for "this period's" available capacity, which is exactly the
-- intended "current-period top-up, not a permanent increase" behavior --
-- no expiry job/cron is needed, it falls out of the query scoping itself.

create table if not exists watch_media_moderation_expansions (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null,
  period_start  timestamptz not null,
  period_end    timestamptz not null,
  units         integer not null check (units > 0),
  price_usd     numeric(10,2) not null check (price_usd >= 0),
  payment_ref   text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_watch_media_moderation_expansions_account_period
  on watch_media_moderation_expansions (account_id, period_start);

alter table watch_media_moderation_expansions enable row level security;
-- No policies: service-role only (runtime), same convention as
-- watch_media_moderation_usage and every other Watch runtime-state table.
