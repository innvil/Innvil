-- =============================================================================
-- Veyra — Row Level Security
-- Access model:
--   * super_admin  -> full access (checked via is_super_admin()).
--   * panel_owner / staff -> rows for panels they own or are a member of
--     (is_panel_member(panel_id)).
--   * customer -> only their own customer_account rows and children
--     (owns_customer(customer_id)).
-- Provider API keys: the encrypted column is additionally revoked at the
-- column level so it can never be selected by anon/authenticated, even for a
-- panel a user owns. Keys are read only server-side via get_provider_key()
-- using the service-role client.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER so they can read profiles/panels under RLS)
-- ----------------------------------------------------------------------------
create or replace function is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'super_admin'
  );
$$;

create or replace function is_panel_member(p_panel uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from panels where id = p_panel and owner_id = auth.uid()
  ) or exists (
    select 1 from panel_members where panel_id = p_panel and user_id = auth.uid()
  );
$$;

create or replace function owns_customer(p_customer uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from customer_accounts
     where id = p_customer and user_id = auth.uid()
  );
$$;

-- Convenience: can the current user administer the panel a customer belongs to?
create or replace function can_admin_customer(p_customer uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from customer_accounts ca
     where ca.id = p_customer and is_panel_member(ca.panel_id)
  );
$$;

-- ----------------------------------------------------------------------------
-- Enable RLS on every table
-- ----------------------------------------------------------------------------
alter table profiles              enable row level security;
alter table panels                enable row level security;
alter table panel_members         enable row level security;
alter table customer_accounts     enable row level security;
alter table providers             enable row level security;
alter table provider_categories   enable row level security;
alter table services              enable row level security;
alter table orders                enable row level security;
alter table order_status_history  enable row level security;
alter table balance_transactions  enable row level security;
alter table payments              enable row level security;
alter table tickets               enable row level security;
alter table ticket_messages       enable row level security;
alter table faq                   enable row level security;
alter table audit_logs            enable row level security;

-- ----------------------------------------------------------------------------
-- profiles: a user sees/edits their own; super admin sees all
-- ----------------------------------------------------------------------------
create policy profiles_self_select on profiles for select
  using (id = auth.uid() or is_super_admin());
create policy profiles_self_update on profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- ----------------------------------------------------------------------------
-- panels: owner + members read; owner writes; super admin all
-- ----------------------------------------------------------------------------
create policy panels_read on panels for select
  using (is_panel_member(id) or is_super_admin());
create policy panels_insert on panels for insert
  with check (owner_id = auth.uid());
create policy panels_update on panels for update
  using (owner_id = auth.uid() or is_super_admin())
  with check (owner_id = auth.uid() or is_super_admin());
create policy panels_delete on panels for delete
  using (owner_id = auth.uid() or is_super_admin());

-- ----------------------------------------------------------------------------
-- panel_members: panel owner/members manage staff
-- ----------------------------------------------------------------------------
create policy panel_members_all on panel_members for all
  using (is_panel_member(panel_id) or is_super_admin())
  with check (is_panel_member(panel_id) or is_super_admin());

-- ----------------------------------------------------------------------------
-- customer_accounts: panel admins manage; customers read their own
-- ----------------------------------------------------------------------------
create policy customer_accounts_admin on customer_accounts for all
  using (is_panel_member(panel_id) or is_super_admin())
  with check (is_panel_member(panel_id) or is_super_admin());
create policy customer_accounts_self_read on customer_accounts for select
  using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- providers / provider_categories / services: panel admins only
-- (customers never touch providers; services are read via panel-scoped views
--  or a dedicated public policy added when the storefront needs it)
-- ----------------------------------------------------------------------------
create policy providers_admin on providers for all
  using (is_panel_member(panel_id) or is_super_admin())
  with check (is_panel_member(panel_id) or is_super_admin());

create policy provider_categories_admin on provider_categories for all
  using (is_panel_member(panel_id) or is_super_admin())
  with check (is_panel_member(panel_id) or is_super_admin());

create policy services_admin on services for all
  using (is_panel_member(panel_id) or is_super_admin())
  with check (is_panel_member(panel_id) or is_super_admin());
-- customers may read only active services of their panel
create policy services_customer_read on services for select
  using (
    status = 'active' and exists (
      select 1 from customer_accounts ca
       where ca.panel_id = services.panel_id and ca.user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- orders: panel admins full; customers read/create their own
-- ----------------------------------------------------------------------------
create policy orders_admin on orders for all
  using (is_panel_member(panel_id) or is_super_admin())
  with check (is_panel_member(panel_id) or is_super_admin());
create policy orders_customer_read on orders for select
  using (owns_customer(customer_id));
create policy orders_customer_insert on orders for insert
  with check (owns_customer(customer_id));

create policy order_status_history_read on order_status_history for select
  using (
    exists (
      select 1 from orders o
       where o.id = order_status_history.order_id
         and (is_panel_member(o.panel_id) or owns_customer(o.customer_id))
    )
  );

-- ----------------------------------------------------------------------------
-- balance_transactions: admins full; customer reads own (writes go through
-- apply_balance_change() which is SECURITY DEFINER, so no customer insert policy)
-- ----------------------------------------------------------------------------
create policy balance_tx_admin on balance_transactions for select
  using (is_panel_member(panel_id) or is_super_admin());
create policy balance_tx_customer_read on balance_transactions for select
  using (owns_customer(customer_id));

-- ----------------------------------------------------------------------------
-- payments: admins full; customer reads/creates own deposits
-- ----------------------------------------------------------------------------
create policy payments_admin on payments for all
  using (is_panel_member(panel_id) or is_super_admin())
  with check (is_panel_member(panel_id) or is_super_admin());
create policy payments_customer_read on payments for select
  using (owns_customer(customer_id));
create policy payments_customer_insert on payments for insert
  with check (owns_customer(customer_id) and status = 'pending');

-- ----------------------------------------------------------------------------
-- tickets + messages: admins full; customer own
-- ----------------------------------------------------------------------------
create policy tickets_admin on tickets for all
  using (is_panel_member(panel_id) or is_super_admin())
  with check (is_panel_member(panel_id) or is_super_admin());
create policy tickets_customer on tickets for all
  using (owns_customer(customer_id))
  with check (owns_customer(customer_id));

create policy ticket_messages_access on ticket_messages for all
  using (
    exists (
      select 1 from tickets t
       where t.id = ticket_messages.ticket_id
         and (is_panel_member(t.panel_id) or owns_customer(t.customer_id))
    )
  )
  with check (
    exists (
      select 1 from tickets t
       where t.id = ticket_messages.ticket_id
         and (is_panel_member(t.panel_id) or owns_customer(t.customer_id))
    )
  );

-- ----------------------------------------------------------------------------
-- faq: admins write; anyone in the panel (customers) reads published entries
-- ----------------------------------------------------------------------------
create policy faq_admin on faq for all
  using (is_panel_member(panel_id) or is_super_admin())
  with check (is_panel_member(panel_id) or is_super_admin());
create policy faq_public_read on faq for select
  using (published = true);

-- ----------------------------------------------------------------------------
-- audit_logs: panel admins read
-- ----------------------------------------------------------------------------
create policy audit_logs_read on audit_logs for select
  using (is_panel_member(panel_id) or is_super_admin());

-- ----------------------------------------------------------------------------
-- Provider API key hardening
--   * Revoke the encrypted column from client roles (defence in depth: even a
--     buggy policy can't leak it).
--   * Lock the key encrypt/decrypt functions to the service role only.
-- ----------------------------------------------------------------------------
revoke select (api_key_enc) on providers from anon, authenticated;

revoke all on function set_provider_key(uuid, text, text) from anon, authenticated;
revoke all on function get_provider_key(uuid, text)       from anon, authenticated;
grant execute on function set_provider_key(uuid, text, text) to service_role;
grant execute on function get_provider_key(uuid, text)       to service_role;

-- apply_balance_change is called from trusted server routes (service role) and
-- from SECURITY DEFINER flows; keep it off the client.
revoke all on function apply_balance_change(uuid, numeric, balance_tx_type, text, uuid, uuid)
  from anon, authenticated;
grant execute on function apply_balance_change(uuid, numeric, balance_tx_type, text, uuid, uuid)
  to service_role;
