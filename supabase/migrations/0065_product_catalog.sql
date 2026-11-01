-- 0065_product_catalog.sql
--
-- Phase 1 of the Innvil multi-product architecture: a GENERIC, official
-- Product Catalog (Innvil / Innvil Forge / Innvil Watch / Innvil Herald /
-- future products), superadmin-managed. This is deliberately NOT a Watch-
-- specific table -- no `is_watch`/`is_panel`/`is_campaign` columns. It is
-- pure product IDENTITY + lifecycle metadata; plans/subscriptions/
-- entitlements for a product remain in that product's OWN existing systems
-- (e.g. Virtual Moderator entitlement stays in panels.settings /
-- customer_moderator_entitlement -- untouched by this migration).
--
-- Phase 2 (this same pass, application code): Innvil Watch is registered as
-- the first row and becomes the first product actually wired through this
-- catalog -- see src/lib/products/watch.ts for the (read-only, additive)
-- mapping. No existing table/column/relationship is renamed or altered.

begin;

create table if not exists products (
  id                     uuid primary key default gen_random_uuid(),
  slug                   text not null unique,           -- immutable identity key, e.g. 'forge' | 'watch' | 'herald'
  name                   text not null,                  -- display name, e.g. "Innvil Watch" -- changing this must never affect ownership (keyed by id/slug, not name)
  description            text,
  status                 text not null default 'draft'
                           check (status in ('draft', 'private_beta', 'active', 'hidden', 'retired')),
  domain                 text,                            -- e.g. 'watch.innvil.cloud'; null until a product gets its own standalone host
  standalone_available   boolean not null default false,  -- can be owned/used without any other product
  cross_sell_available   boolean not null default false,  -- may be promoted/discovered from another product's surface
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create trigger trg_products_updated before update on products
  for each row execute function set_updated_at();

alter table products enable row level security;
-- No policies: service-role only (superadmin actions read/write this via
-- the service-role client, same pattern as every other superadmin-managed
-- table in this schema -- platform_settings, design_pricing, etc.).

-- Seed the three named products from the architecture doc. Forge and Watch
-- already have real, live functionality (Panel creation and Virtual
-- Moderator respectively) so they seed 'active'; Herald has no
-- functionality yet and seeds 'draft' per the explicit "do not implement
-- Herald" instruction. Idempotent (ON CONFLICT DO NOTHING) so re-running
-- this migration never clobbers a superadmin's later edits.
insert into products (slug, name, description, status, domain, standalone_available, cross_sell_available)
values
  ('forge', 'Innvil Forge', 'Create and manage white-label SMM panels.', 'active', null, true, true),
  ('watch', 'Innvil Watch', 'AI-powered community moderation -- deploy Watchers (Virtual Moderators) into your Telegram communities.', 'active', 'watch.innvil.cloud', true, true),
  ('herald', 'Innvil Herald', 'Campaigns, outreach, and announcements (coming soon).', 'draft', null, false, true)
on conflict (slug) do nothing;

commit;
