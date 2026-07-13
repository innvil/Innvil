"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthedAdmin } from "@/src/lib/auth";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { sendEmail, simpleEmail } from "@/src/lib/email/resend";
import type { TicketStatus, TicketMessageVM } from "@/src/lib/actions/tickets";

/* =========================================================
   §8 SUPPORT TICKETS — owner side (owner session)
   The panel owner lists/answers/closes tickets on panels they own. Ownership is
   enforced in code via the service-role client.
   ========================================================= */

type Result = { ok: true } | { ok: false; error: string };

export interface OwnerTicketVM {
  id: string;
  subject: string;
  status: TicketStatus;
  lastSender: "customer" | "owner";
  unread: boolean; // unread for the owner
  customerUsername: string | null;
  customerEmail: string | null;
  updatedAt: string;
  lastMessageAt: string;
}

export interface OwnerTicketThread {
  ticket: OwnerTicketVM;
  messages: TicketMessageVM[];
}

async function ownsPanel(admin: SupabaseClient, userId: string, panelId: string): Promise<boolean> {
  const { data } = await admin.from("panels").select("id").eq("id", panelId).eq("owner_id", userId).maybeSingle();
  return !!data;
}

/** Resolve a customer_account identity (profile username + login email, best-effort). */
async function accountIdentity(
  admin: SupabaseClient,
  accountId: string
): Promise<{ username: string | null; email: string | null }> {
  const { data: acct } = await admin.from("customer_accounts").select("user_id").eq("id", accountId).maybeSingle();
  if (!acct?.user_id) return { username: null, email: null };

  const { data: profile } = await admin
    .from("profiles")
    .select("display_name")
    .eq("id", acct.user_id as string)
    .maybeSingle();
  const username = (profile?.display_name as string | null) ?? null;
  return { username, email: null };
}

/** All tickets on a panel the owner controls (newest activity first). */
export async function listPanelTickets(panelId: string): Promise<OwnerTicketVM[]> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return [];
  if (!(await ownsPanel(admin, user.id, panelId))) return [];

  const { data } = await admin
    .from("support_tickets")
    .select("id, subject, status, last_sender, owner_unread, customer_id, updated_at, last_message_at")
    .eq("panel_id", panelId)
    .order("last_message_at", { ascending: false });

  const rows = data ?? [];
  // Resolve emails (small N per panel).
  const who = new Map<string, { username: string | null; email: string | null }>();
  for (const r of rows) {
    const cid = r.customer_id as string;
    if (!who.has(cid)) who.set(cid, await accountIdentity(admin, cid));
  }
  return rows.map((r) => ({
    id: r.id as string,
    subject: r.subject as string,
    status: r.status as TicketStatus,
    lastSender: (r.last_sender as "customer" | "owner") ?? "customer",
    unread: !!r.owner_unread,
    customerUsername: who.get(r.customer_id as string)?.username ?? null,
    customerEmail: who.get(r.customer_id as string)?.email ?? null,
    updatedAt: r.updated_at as string,
    lastMessageAt: (r.last_message_at as string) ?? (r.updated_at as string),
  }));
}

/** One ticket + thread (owner view). Clears the owner's unread flag. */
export async function getOwnerTicket(ticketId: string): Promise<OwnerTicketThread | null> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return null;
  const { data: ticket } = await admin
    .from("support_tickets")
    .select("id, panel_id, customer_id, subject, status, last_sender, owner_unread, updated_at, last_message_at")
    .eq("id", ticketId)
    .maybeSingle();
  if (!ticket || !(await ownsPanel(admin, user.id, ticket.panel_id as string))) return null;

  const { data: messages } = await admin
    .from("support_ticket_messages")
    .select("id, sender_role, body, created_at")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });

  if (ticket.owner_unread) await admin.from("support_tickets").update({ owner_unread: false }).eq("id", ticketId);
  const who = await accountIdentity(admin, ticket.customer_id as string);

  return {
    ticket: {
      id: ticket.id as string,
      subject: ticket.subject as string,
      status: ticket.status as TicketStatus,
      lastSender: (ticket.last_sender as "customer" | "owner") ?? "customer",
      unread: false,
      customerUsername: who.username,
      customerEmail: who.email,
      updatedAt: ticket.updated_at as string,
      lastMessageAt: (ticket.last_message_at as string) ?? (ticket.updated_at as string),
    },
    messages: (messages ?? []).map((m) => ({
      id: m.id as string, senderRole: m.sender_role as "customer" | "owner", body: m.body as string, createdAt: m.created_at as string,
    })),
  };
}

/** Owner replies to a ticket. Marks it answered + notifies the customer (best-effort). */
export async function ownerReplyToTicket(ticketId: string, message: string): Promise<Result> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };
  const body = message.trim();
  if (!body) return { ok: false, error: "Write a reply." };

  const { data: ticket } = await admin
    .from("support_tickets")
    .select("id, panel_id, customer_id, subject")
    .eq("id", ticketId)
    .maybeSingle();
  if (!ticket || !(await ownsPanel(admin, user.id, ticket.panel_id as string))) return { ok: false, error: "Ticket not found." };

  await admin.from("support_ticket_messages").insert({ ticket_id: ticketId, sender_role: "owner", sender_id: user.id, body });
  await admin.from("support_tickets").update({
    status: "answered", last_sender: "owner", customer_unread: true, owner_unread: false,
    last_message_at: new Date().toISOString(),
  }).eq("id", ticketId);

  // Notify the customer by email (best-effort).
  try {
    const email = (await accountIdentity(admin, ticket.customer_id as string)).email;
    const { data: panel } = await admin.from("panels").select("name, subdomain").eq("id", ticket.panel_id as string).maybeSingle();
    const app = process.env.NEXT_PUBLIC_APP_URL?.trim() || "";
    const url = app && panel?.subdomain ? `${app}/p/${panel.subdomain}` : undefined;
    await sendEmail({
      to: email,
      subject: `Reply to your support ticket — ${panel?.name ?? "your panel"}`,
      html: simpleEmail(
        `${panel?.name ?? "Support"} replied to your ticket`,
        [`Re: <strong>${ticket.subject}</strong>`, "Log in to view the reply and continue the conversation."],
        url ? { label: "View ticket", url } : undefined
      ),
    });
  } catch { /* best-effort */ }

  return { ok: true };
}

/** Owner closes or reopens a ticket. */
export async function setTicketStatus(ticketId: string, status: TicketStatus): Promise<Result> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };
  const { data: ticket } = await admin.from("support_tickets").select("id, panel_id").eq("id", ticketId).maybeSingle();
  if (!ticket || !(await ownsPanel(admin, user.id, ticket.panel_id as string))) return { ok: false, error: "Ticket not found." };
  await admin.from("support_tickets").update({ status }).eq("id", ticketId);
  return { ok: true };
}

/** Count of tickets needing the owner's attention (for a badge). */
export async function countOpenPanelTickets(panelId: string): Promise<number> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return 0;
  if (!(await ownsPanel(admin, user.id, panelId))) return 0;
  const { count } = await admin
    .from("support_tickets")
    .select("id", { count: "exact", head: true })
    .eq("panel_id", panelId)
    .eq("owner_unread", true);
  return count ?? 0;
}
