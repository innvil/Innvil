-- =============================================================================
-- Innvil — provider_categories hierarchy
-- Adds a self-referential parent_id so categories can nest two levels:
--   platform category (parent_id NULL, e.g. "Instagram Services")
--     └─ sub-category (parent_id = platform, e.g. "Followers")
--        └─ services (services.category_id points at the sub-category)
-- Idempotent.
-- =============================================================================

alter table provider_categories
  add column if not exists parent_id uuid references provider_categories (id) on delete cascade;

create index if not exists idx_provider_categories_parent
  on provider_categories (parent_id);
