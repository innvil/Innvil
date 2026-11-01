-- ============================================================================
-- 0024_provider_topup_refunds.sql
-- Refund-aware provider top-up tracking (Option A + manual review).
--   * providers.pending_refund_credit — expected provider-side refund not yet seen
--     in the balance. When the sync refunds/cancels/partials an order, we queue the
--     estimated provider credit here; the NEXT balance increase nets it out first, so
--     a refund landing on the balance isn't logged as a top-up.
--   * provider_topups.kind      — 'topup' (counts) | 'refund' (excluded from totals/CSV).
--   * provider_topups.needs_review — the increase overlapped a known refund, so the
--     owner should confirm ("Is this a refund?").
-- Requires 0023 (provider_topups) + 0001 (providers). Idempotent.
-- ============================================================================

alter table provider_topups add column if not exists kind text not null default 'topup';
alter table provider_topups add column if not exists needs_review boolean not null default false;
alter table providers add column if not exists pending_refund_credit numeric(14,4) not null default 0;

-- Atomic +/- on the refund credit (clamped at 0). Used by the sync (add) and the
-- balance-sync top-up detector (subtract what a balance increase absorbed).
create or replace function bump_provider_refund_credit(p_provider uuid, p_amount numeric)
returns void
language sql security definer set search_path = public as $$
  update providers
     set pending_refund_credit = greatest(round(coalesce(pending_refund_credit, 0) + p_amount, 4), 0)
   where id = p_provider;
$$;
revoke all on function bump_provider_refund_credit(uuid, numeric) from anon, authenticated;
grant execute on function bump_provider_refund_credit(uuid, numeric) to service_role;
