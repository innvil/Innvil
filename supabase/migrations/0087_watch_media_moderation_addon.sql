-- Self-serve Media Moderation + -- a second, real add-on layered on the
-- SAME watch_subscription_addons table Community Expansion already uses
-- (migration 0083), never a duplicated/parallel add-on system. The existing
-- partial unique index on (account_id, addon_type) where status='active'
-- already scopes uniqueness PER addon_type, so an account can hold an
-- active 'community_expansion' row AND an active 'media_moderation' row at
-- the same time -- exactly the intended behavior (the two add-ons are
-- independent purchases).
--
-- This migration widens the addon_type CHECK only. No purchase/renewal/
-- removal action writes 'media_moderation' rows yet -- this is the
-- entitlement/schema layer only (see src/lib/products/watch-media-
-- moderation-addon.ts and the dated CLAUDE.md entry for what is and isn't
-- built yet).
alter table watch_subscription_addons drop constraint if exists watch_subscription_addons_addon_type_check;
alter table watch_subscription_addons add constraint watch_subscription_addons_addon_type_check
  check (addon_type in ('community_expansion', 'media_moderation'));
