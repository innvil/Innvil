"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createStorefrontClient } from "@/src/lib/supabase/server";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { sendEmail, simpleEmail } from "@/src/lib/email/resend";
import { readWelcomeConfig } from "@/src/lib/welcome";

/* =========================================================
   §8 SUPPORT TICKETS — customer side (storefront session)
   A customer opens/replies to tickets on the panel they belong to. All writes go
   through the service-role client after verifying the ticket belongs to the
   signed-in customer. Owner replies live in admin-tickets.ts.
   ========================================================= */

export type TicketStatus = "open" | "answered" | "closed";

export interface TicketVM {
  id: string;
  subject: string;
  status: TicketStatus;
  lastSender: "customer" | "owner";
  unread: boolean; // unread for the viewer
  updatedAt: string;
  lastMessageAt: string;
}

export interface TicketMessageVM {
  id: string;
  senderRole: "customer" | "owner";
  body: string;
  createdAt: string;
}

export interface TicketThread {
  ticket: TicketVM;
  messages: TicketMessageVM[];
}

type Result<T = void> = ({ ok: true } & (T extends void ? object : { data: T })) | { ok: false; error: string };

/** The signed-in customer's account on a panel (or null). */
async function getCustomer(panelId?: string): Promise<{ userId: string; accountId: string; panelId: string } | null> {
  const supa = await createStorefrontClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return null;
  const admin = createAdminClient();
  let q = admin.from("customer_accounts").select("id, panel_id").eq("user_id", user.id);
  if (panelId) q = q.eq("panel_id", panelId);
  const { data } = await q.maybeSingle();
  if (!data) return null;
  return { userId: user.id, accountId: data.id as string, panelId: data.panel_id as string };
}

function toTicketVM(row: Record<string, unknown>, viewer: "customer" | "owner"): TicketVM {
  return {
    id: row.id as string,
    subject: row.subject as string,
    status: row.status as TicketStatus,
    lastSender: (row.last_sender as "customer" | "owner") ?? "customer",
    unread: viewer === "customer" ? !!row.customer_unread : !!row.owner_unread,
    updatedAt: row.updated_at as string,
    lastMessageAt: (row.last_message_at as string) ?? (row.updated_at as string),
  };
}

/** Notify the panel owner by email (best-effort) that a customer wrote in. */
async function notifyOwner(admin: SupabaseClient, panelId: string, subject: string) {
  try {
    const { data: panel } = await admin.from("panels").select("owner_id, name").eq("id", panelId).maybeSingle();
    if (!panel?.owner_id) return;
    const { data } = await admin.auth.admin.getUserById(panel.owner_id as string);
    const to = data.user?.email ?? null;
    const app = process.env.NEXT_PUBLIC_APP_URL?.trim() || "";
    await sendEmail({
      to,
      subject: `New support message — ${panel.name}`,
      html: simpleEmail(
        `New support message on ${panel.name}`,
        [`A customer replied to the ticket: <strong>${subject}</strong>.`, "Open your dashboard to respond."],
        app ? { label: "Open dashboard", url: app } : undefined
      ),
    });
  } catch { /* best-effort */ }
}

/** Open a new ticket with the first message. */
export async function createTicket(panelId: string, subject: string, message: string): Promise<Result<{ id: string }>> {
  const c = await getCustomer(panelId);
  if (!c) return { ok: false, error: "Please log in to contact support." };
  const subj = subject.trim();
  const body = message.trim();
  if (!subj) return { ok: false, error: "Add a subject." };
  if (!body) return { ok: false, error: "Write your message." };

  const admin = createAdminClient();
  const { data: ticket, error } = await admin
    .from("support_tickets")
    .insert({
      panel_id: c.panelId, customer_id: c.accountId, subject: subj,
      status: "open", last_sender: "customer", owner_unread: true, customer_unread: false,
      last_message_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !ticket) return { ok: false, error: error?.message ?? "Could not open the ticket." };
  await admin.from("support_ticket_messages").insert({ ticket_id: ticket.id, sender_role: "customer", sender_id: c.userId, body });
  await notifyOwner(admin, c.panelId, subj);
  return { ok: true, data: { id: ticket.id as string } };
}

/** The signed-in customer's tickets on a panel (newest activity first). */
export async function listCustomerTickets(panelId: string): Promise<TicketVM[]> {
  const c = await getCustomer(panelId);
  if (!c) return [];
  const admin = createAdminClient();
  const { data } = await admin
    .from("support_tickets")
    .select("id, subject, status, last_sender, customer_unread, owner_unread, updated_at, last_message_at")
    .eq("customer_id", c.accountId)
    .order("last_message_at", { ascending: false });
  return (data ?? []).map((r) => toTicketVM(r, "customer"));
}

/** One ticket + its full thread (customer view). Clears the customer's unread flag. */
export async function getCustomerTicket(ticketId: string): Promise<TicketThread | null> {
  const admin = createAdminClient();
  const { data: ticket } = await admin
    .from("support_tickets")
    .select("id, panel_id, subject, status, last_sender, customer_unread, owner_unread, updated_at, last_message_at, customer_id")
    .eq("id", ticketId)
    .maybeSingle();
  if (!ticket) return null;
  const c = await getCustomer(ticket.panel_id as string);
  if (!c || ticket.customer_id !== c.accountId) return null;

  const { data: messages } = await admin
    .from("support_ticket_messages")
    .select("id, sender_role, body, created_at")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });

  if (ticket.customer_unread) await admin.from("support_tickets").update({ customer_unread: false }).eq("id", ticketId);

  return {
    ticket: toTicketVM(ticket, "customer"),
    messages: (messages ?? []).map((m) => ({
      id: m.id as string, senderRole: m.sender_role as "customer" | "owner", body: m.body as string, createdAt: m.created_at as string,
    })),
  };
}

/** Customer replies to their ticket. Reopens it if it was closed. */
export async function customerReply(ticketId: string, message: string): Promise<Result> {
  const body = message.trim();
  if (!body) return { ok: false, error: "Write your message." };

  const admin = createAdminClient();
  const { data: ticket } = await admin.from("support_tickets").select("id, customer_id, panel_id, subject, kind, welcome_bonus_granted").eq("id", ticketId).maybeSingle();
  if (!ticket) return { ok: false, error: "Ticket not found." };
  const c = await getCustomer(ticket.panel_id as string);
  if (!c || ticket.customer_id !== c.accountId) return { ok: false, error: "Ticket not found." };

  await admin.from("support_ticket_messages").insert({ ticket_id: ticketId, sender_role: "customer", sender_id: c.userId, body });
  await admin.from("support_tickets").update({
    status: "open", last_sender: "customer", owner_unread: true, customer_unread: false,
    last_message_at: new Date().toISOString(),
  }).eq("id", ticketId);

  // Welcome bonus: the first time a customer replies to their welcome ticket, grant the
  // owner's configured free credit — once, atomically flagged so it can't be farmed.
  if (ticket.kind === "welcome" && !ticket.welcome_bonus_granted) {
    const { data: panel } = await admin.from("panels").select("settings").eq("id", ticket.panel_id).maybeSingle();
    const cfg = readWelcomeConfig(panel?.settings);
    if (cfg.creditEnabled && cfg.creditAmount > 0) {
      // Claim the flag first (idempotent guard against concurrent double-claims).
      const { data: claimed } = await admin
        .from("support_tickets")
        .update({ welcome_bonus_granted: true })
        .eq("id", ticketId)
        .eq("welcome_bonus_granted", false)
        .select("id")
        .maybeSingle();
      if (claimed) {
        const { error: creditErr } = await admin.rpc("apply_balance_change", {
          p_customer: c.accountId,
          p_amount: cfg.creditAmount,
          p_type: "manual_adjust",
          p_reason: "Welcome bonus",
        });
        // Roll the flag back on failure so it can be granted on a later reply.
        if (creditErr) await admin.from("support_tickets").update({ welcome_bonus_granted: false }).eq("id", ticketId);
      }
    }
  }

  await notifyOwner(admin, ticket.panel_id as string, ticket.subject as string);
  return { ok: true };
}

/** Customer closes their own ticket. */
export async function customerCloseTicket(ticketId: string): Promise<Result> {
  const admin = createAdminClient();
  const { data: ticket } = await admin.from("support_tickets").select("id, customer_id, panel_id").eq("id", ticketId).maybeSingle();
  if (!ticket) return { ok: false, error: "Ticket not found." };
  const c = await getCustomer(ticket.panel_id as string);
  if (!c || ticket.customer_id !== c.accountId) return { ok: false, error: "Ticket not found." };
  await admin.from("support_tickets").update({ status: "closed" }).eq("id", ticketId);
  return { ok: true };
}
