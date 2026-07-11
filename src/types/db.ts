/* =========================================================
   DATABASE ROW TYPES (Phase 3)
   Mirror the tables in supabase/migrations/0001_init.sql.
   Hand-maintained for now; can be replaced by `supabase gen types`
   once the project is provisioned.
   ========================================================= */

import type { PanelStatus } from "@/src/data/constants";
export type { PanelStatus };

export type UserRole = "super_admin" | "panel_owner" | "staff" | "customer";
export type ProviderStatus = "active" | "paused";
export type ServiceStatus = "active" | "disabled";
export type MarkupKind = "percent" | "multiplier" | "fixed";
export type OrderStatus =
  | "pending"
  | "processing"
  | "in_progress"
  | "partial"
  | "completed"
  | "canceled"
  | "failed"
  | "refunded";
export type CustomerStatus = "active" | "banned" | "restricted";
export type PaymentStatus = "pending" | "approved" | "rejected" | "completed";
export type TicketStatus = "open" | "answered" | "closed";
export type BalanceTxType = "deposit" | "order" | "refund" | "manual_adjust";

export interface ProfileRow {
  id: string;
  role: UserRole;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface PanelRow {
  id: string;
  owner_id: string;
  name: string;
  subdomain: string;
  custom_domain: string | null;
  status: PanelStatus;
  theme: string | null;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface PanelMemberRow {
  panel_id: string;
  user_id: string;
  role: string;
  permissions: Record<string, unknown>;
  created_at: string;
}

export interface CustomerAccountRow {
  id: string;
  panel_id: string;
  user_id: string;
  status: CustomerStatus;
  balance: number;
  api_key_hash: string | null;
  created_at: string;
  updated_at: string;
}

/** NOTE: api_key_enc is intentionally absent — it is never returned to clients. */
export interface ProviderRow {
  id: string;
  panel_id: string;
  name: string;
  api_url: string;
  status: ProviderStatus;
  balance: number | null;
  currency: string;
  last_balance_sync: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProviderCategoryRow {
  id: string;
  panel_id: string;
  provider_id: string | null;
  name: string;
  created_at: string;
}

export interface ServiceRow {
  id: string;
  panel_id: string;
  local_id: number | null;
  provider_id: string | null;
  provider_service_id: string | null;
  category_id: string | null;
  name: string;
  type: string | null;
  platform: string | null;
  provider_rate: number;
  markup_kind: MarkupKind;
  markup_value: number;
  sell_rate: number;
  min: number;
  max: number;
  description: string | null;
  status: ServiceStatus;
  sort_order: number;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderRow {
  id: string;
  panel_id: string;
  customer_id: string;
  service_id: string | null;
  provider_id: string | null;
  link: string;
  quantity: number;
  charge: number;
  provider_cost: number;
  profit: number;
  provider_order_id: string | null;
  status: OrderStatus;
  start_count: number | null;
  remains: number | null;
  provider_payload: Record<string, unknown> | null;
  provider_response: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface OrderStatusHistoryRow {
  id: string;
  order_id: string;
  status: OrderStatus;
  note: string | null;
  created_at: string;
}

export interface BalanceTransactionRow {
  id: string;
  panel_id: string;
  customer_id: string;
  amount: number;
  type: BalanceTxType;
  reason: string | null;
  admin_id: string | null;
  ref_order_id: string | null;
  balance_after: number;
  created_at: string;
}

export interface PaymentRow {
  id: string;
  panel_id: string;
  customer_id: string;
  method: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  gateway: string | null;
  gateway_ref: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TicketRow {
  id: string;
  panel_id: string;
  customer_id: string;
  subject: string;
  status: TicketStatus;
  created_at: string;
  updated_at: string;
}

export interface TicketMessageRow {
  id: string;
  ticket_id: string;
  sender_id: string | null;
  is_staff: boolean;
  body: string;
  created_at: string;
}

export interface FaqRow {
  id: string;
  panel_id: string;
  question: string;
  answer: string;
  category: string | null;
  sort_order: number;
  published: boolean;
  created_at: string;
  updated_at: string;
}

export interface AuditLogRow {
  id: string;
  panel_id: string | null;
  actor_id: string | null;
  action: string;
  meta: Record<string, unknown>;
  created_at: string;
}
