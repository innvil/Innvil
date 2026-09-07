-- =============================================================================
-- Innvil — per-panel local service IDs
-- Each panel numbers its own services 1, 2, 3… (the ID the panel's customers and
-- customer-facing API see) — separate from the provider's service ID, which we
-- keep for internal order routing (services.provider_service_id).
-- Idempotent.
-- =============================================================================

alter table services add column if not exists local_id integer;

-- Backfill existing rows: number per panel by creation order.
with numbered as (
  select id, row_number() over (partition by panel_id order by created_at, id) as rn
  from services
)
update services s
   set local_id = n.rn
  from numbered n
 where n.id = s.id and s.local_id is null;

create unique index if not exists uq_services_panel_local on services (panel_id, local_id);
