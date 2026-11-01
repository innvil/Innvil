-- Enterprise Media Moderation + becomes a real, explicitly-granted state
-- (previously: media moderation ran unconditionally/unmetered for EVERY
-- Enterprise account once MEDIA_MODERATION_ENABLED was on, with no way to
-- represent "this account actually has the add-on" at all -- see
-- money.ts's ENTERPRISE_MEDIA_ADDON pricing, which was pure copy with no
-- backing entitlement state until now).
--
-- GRANDFATHER DEFAULT: the column defaults to `false` for every NEW row
-- (an explicit opt-in add-on, matching its own "never bundled into the
-- base price" pricing) -- but every EXISTING active Enterprise row is
-- backfilled to `true` in the same migration, so no currently-live
-- Enterprise account silently loses media moderation the moment this gate
-- goes into effect. Going forward, a NEW Enterprise grant must explicitly
-- opt in via the devops tool.

alter table product_entitlements
  add column if not exists enterprise_media_addon boolean not null default false;

update product_entitlements
set enterprise_media_addon = true
where status = 'active'
  and split_part(subscription_ref, ':', 1) = 'enterprise';
