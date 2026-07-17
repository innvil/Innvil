import { createHash } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { round4 } from "@/src/lib/money";
import { validateOrderLink } from "@/src/lib/order-link";
import { getProviderCredentials, addOrder, getStatus, getMultiStatus, refillOrder, cancelOrders, ProviderError } from "@/src/lib/providers";
import type { OrderStatus } from "@/src/types/db";

export const dynamic = "force-dynamic";

type ApiUser = {
  accountId: string;
  panelId: string;
  balance: number;
  accountStatus: string;
  panelStatus: string;
  panelCurrency: string;
  apiEnabled: boolean;
};

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function panelCurrency(settings: unknown): string {
  if (settings && typeof settings === "object") {
    const c = (settings as Record<string, unknown>).currency;
    if (typeof c === "string" && c) return c.toUpperCase();
  }
  return "USD";
}

function panelApiEnabled(settings: unknown): boolean {
  if (settings && typeof settings === "object") {
    const api = (settings as Record<string, unknown>).customerApi;
    if (api && typeof api === "object") {
      const enabled = (api as Record<string, unknown>).enabled;
      if (enabled === false) return false;
    }
  }
  return true;
}

function normalizeStatus(s: string): string {
  const x = s.toLowerCase();
  if (x === "in_progress") return "Processing";
  if (x === "processing") return "Processing";
  if (x === "completed") return "Completed";
  if (x === "partial") return "Partial";
  if (x === "pending") return "Pending";
  if (x === "canceled") return "Canceled";
  if (x === "failed") return "Failed";
  if (x === "refunded") return "Refunded";
  return s;
}

async function parseParams(req: NextRequest): Promise<Record<string, string>> {
  if (req.method === "POST") {
    const ctype = req.headers.get("content-type") || "";
    if (ctype.includes("application/x-www-form-urlencoded")) {
      const form = await req.formData();
      const out: Record<string, string> = {};
      for (const [k, v] of form.entries()) out[k] = String(v);
      return out;
    }
    try {
      const json = await req.json();
      if (json && typeof json === "object") {
        return Object.fromEntries(
          Object.entries(json).map(([k, v]) => [
            k,
            typeof v === "string"
              ? v
              : v == null
                ? ""
                : typeof v === "object"
                  ? JSON.stringify(v)
                  : String(v),
          ])
        );
      }
    } catch {
      // fallback to query string below
    }
  }

  const out: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

async function loadUserByKey(key: string): Promise<ApiUser | null> {
  const admin = createAdminClient();
  const keyHash = hashApiKey(key);
  const { data } = await admin
    .from("customer_accounts")
    .select("id, panel_id, status, balance, panels(status, settings)")
    .eq("api_key_hash", keyHash)
    .maybeSingle();
  if (!data) return null;

  const panelObj = Array.isArray(data.panels) ? data.panels[0] : data.panels;
  const panelStatus = (panelObj?.status as string | undefined) ?? "draft";
  const settings = panelObj?.settings;

  return {
    accountId: data.id as string,
    panelId: data.panel_id as string,
    balance: Number(data.balance ?? 0),
    accountStatus: (data.status as string) ?? "active",
    panelStatus,
    panelCurrency: panelCurrency(settings),
    apiEnabled: panelApiEnabled(settings),
  };
}

async function addHistory(orderId: string, status: OrderStatus, note?: string) {
  const admin = createAdminClient();
  await admin
    .from("order_status_history")
    .insert({ order_id: orderId, status, note: note ?? null });
}

async function handleServices(u: ApiUser) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("services")
    .select("id, local_id, name, type, sell_rate, min, max, provider_categories(name)")
    .eq("panel_id", u.panelId)
    .eq("status", "active")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  const rows = (data ?? []) as Array<{
    id: string;
    local_id: number | null;
    name: string;
    type: string | null;
    sell_rate: number;
    min: number;
    max: number;
    provider_categories: Array<{ name: string | null }> | null;
  }>;

  return rows.map((r) => ({
    service: r.local_id ?? r.id,
    name: r.name,
    type: r.type ?? "default",
    category: r.provider_categories?.[0]?.name ?? "General",
    rate: Number(r.sell_rate).toFixed(4),
    min: r.min,
    max: r.max,
    refill: false,
    cancel: false,
    drip: false,
  }));
}

async function findService(panelId: string, reqService: string) {
  const admin = createAdminClient();
  const maybeNum = Number(reqService);
  if (Number.isFinite(maybeNum) && Number.isInteger(maybeNum)) {
    const { data } = await admin
      .from("services")
      .select("id, panel_id, provider_id, provider_service_id, sell_rate, provider_rate, min, max, status")
      .eq("panel_id", panelId)
      .eq("local_id", maybeNum)
      .maybeSingle();
    if (data) return data;
  }
  const { data } = await admin
    .from("services")
    .select("id, panel_id, provider_id, provider_service_id, sell_rate, provider_rate, min, max, status")
    .eq("panel_id", panelId)
    .eq("id", reqService)
    .maybeSingle();
  return data;
}

type AddInput = {
  service: string;
  link: string;
  quantity?: string;
  comments?: string;
};

type AddResult =
  | { ok: true; order: string; charge: number }
  | { ok: false; error: string };

async function processAddInput(u: ApiUser, input: AddInput, balanceHint: number): Promise<AddResult> {
  if (u.panelStatus !== "live") {
    return { ok: false, error: "Panel is not accepting new orders right now." };
  }

  const serviceReq = (input.service || "").trim();
  const commentList = (input.comments || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const hasComments = commentList.length > 0;
  const qty = hasComments ? commentList.length : Math.floor(Number(input.quantity));

  if (!serviceReq) return { ok: false, error: "service is required" };
  const linkCheck = validateOrderLink(input.link || "");
  if (!linkCheck.ok) return { ok: false, error: linkCheck.error };
  const link = linkCheck.url;
  if (!Number.isFinite(qty) || qty <= 0) {
    return hasComments
      ? { ok: false, error: "Enter at least 1 comment (one per line)." }
      : { ok: false, error: "quantity is invalid" };
  }

  const svc = await findService(u.panelId, serviceReq);
  if (!svc) return { ok: false, error: "Service not found" };
  if ((svc.status as string) !== "active") return { ok: false, error: "Service is unavailable" };

  if (qty < Number(svc.min) || qty > Number(svc.max)) {
    return { ok: false, error: `Quantity must be between ${svc.min} and ${svc.max}` };
  }

  const charge = round4((qty / 1000) * Number(svc.sell_rate));
  const providerCost = round4((qty / 1000) * Number(svc.provider_rate));
  const profit = round4(charge - providerCost);
  if (balanceHint < charge) return { ok: false, error: "Insufficient balance" };

  const admin = createAdminClient();
  const { data: order, error } = await admin
    .from("orders")
    .insert({
      panel_id: u.panelId,
      customer_id: u.accountId,
      service_id: svc.id,
      provider_id: svc.provider_id,
      link,
      quantity: qty,
      charge,
      provider_cost: providerCost,
      profit,
      status: "pending",
      provider_payload: {
        service: svc.provider_service_id,
        quantity: qty,
        ...(hasComments ? { comments: commentList } : {}),
      },
    })
    .select("id")
    .single();
  if (error || !order) return { ok: false, error: error?.message ?? "Could not create order" };

  await addHistory(order.id as string, "pending", "API order submitted");

  const { error: debitErr } = await admin.rpc("apply_balance_change", {
    p_customer: u.accountId,
    p_amount: -charge,
    p_type: "order",
    p_reason: `API order ${order.id}`,
    p_ref_order: order.id,
  });
  if (debitErr) {
    await admin.from("orders").delete().eq("id", order.id);
    return {
      ok: false,
      error: /insufficient/i.test(debitErr.message) ? "Insufficient balance" : debitErr.message,
    };
  }

  if (svc.provider_id && svc.provider_service_id) {
    try {
      const { data: prov } = await admin
        .from("providers")
        .select("api_url")
        .eq("id", svc.provider_id)
        .maybeSingle();
      if (!prov) throw new Error("Provider not found");

      const creds = await getProviderCredentials(svc.provider_id as string, prov.api_url as string);
      const resp = await addOrder(creds, {
        service: svc.provider_service_id as string,
        link,
        quantity: qty,
        ...(hasComments ? { comments: commentList.join("\n") } : {}),
      });

      if ("order" in resp) {
        await admin
          .from("orders")
          .update({
            provider_order_id: String(resp.order),
            status: "processing",
            provider_response: resp as Record<string, unknown>,
          })
          .eq("id", order.id);
        await addHistory(order.id as string, "processing", "Submitted to provider");
      } else {
        await admin
          .from("orders")
          .update({ provider_response: resp as Record<string, unknown>, status: "failed" })
          .eq("id", order.id);
        await addHistory(order.id as string, "failed", resp.error || "Provider rejected order");
      }
    } catch (e) {
      const msg = e instanceof ProviderError ? e.message : e instanceof Error ? e.message : "Provider error";
      await admin
        .from("orders")
        .update({ status: "failed", provider_response: { error: msg } })
        .eq("id", order.id);
      await addHistory(order.id as string, "failed", msg);
    }
  }

  return { ok: true, order: String(order.id), charge };
}

async function handleAdd(u: ApiUser, params: Record<string, string>) {
  const result = await processAddInput(
    u,
    {
      service: params.service || "",
      link: params.link || "",
      quantity: params.quantity || "",
      comments: params.comments || "",
    },
    u.balance
  );

  if (!result.ok) return { error: result.error };
  return { order: result.order };
}

type BatchAddInput = {
  service: string | number;
  link: string;
  quantity?: string | number;
  comments?: string;
};

async function handleAddMultiple(u: ApiUser, params: Record<string, string>) {
  const raw = (params.orders || "").trim();
  if (!raw) return { error: "orders is required" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "orders must be valid JSON" };
  }

  if (!Array.isArray(parsed)) return { error: "orders must be a JSON array" };
  if (!parsed.length) return { error: "orders cannot be empty" };
  if (parsed.length > 100) return { error: "Maximum 100 orders per batch" };

  let runningBalance = Number(u.balance || 0);
  const results: Array<{ index: number; order?: string; error?: string }> = [];

  for (let i = 0; i < parsed.length; i++) {
    const row = parsed[i] as BatchAddInput;
    const result = await processAddInput(
      u,
      {
        service: String(row?.service ?? ""),
        link: String(row?.link ?? ""),
        quantity: row?.quantity == null ? "" : String(row.quantity),
        comments: row?.comments == null ? "" : String(row.comments),
      },
      runningBalance
    );

    if (!result.ok) {
      results.push({ index: i, error: result.error });
      continue;
    }

    runningBalance = round4(runningBalance - result.charge);
    results.push({ index: i, order: result.order });
  }

  return {
    count: parsed.length,
    success: results.filter((r) => !!r.order).length,
    failed: results.filter((r) => !!r.error).length,
    orders: results,
  };
}

async function findOrderForAccount(accountId: string, ref: string) {
  const admin = createAdminClient();
  const id = ref.trim();
  const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);

  if (uuidLike) {
    const { data } = await admin
      .from("orders")
      .select("id, charge, start_count, status, remains, provider_id, provider_order_id")
      .eq("customer_id", accountId)
      .eq("id", id)
      .maybeSingle();
    return data;
  }

  const { data } = await admin
    .from("orders")
    .select("id, charge, start_count, status, remains, provider_id, provider_order_id")
    .eq("customer_id", accountId)
    .ilike("id", `${id}%`)
    .limit(1)
    .maybeSingle();
  return data;
}

async function handleStatus(u: ApiUser, params: Record<string, string>) {
  const single = (params.order || "").trim();
  const multiple = (params.orders || "").trim();

  if (multiple) {
    const refs = multiple.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 100);
    const out: Record<string, unknown> = {};
    for (const ref of refs) {
      const row = await findOrderForAccount(u.accountId, ref);
      if (!row) {
        out[ref] = { error: "Incorrect order ID" };
      } else {
        out[ref] = {
          charge: Number(row.charge ?? 0).toFixed(4),
          start_count: Number(row.start_count ?? 0),
          status: normalizeStatus(String(row.status ?? "pending")),
          remains: Number(row.remains ?? 0),
          currency: u.panelCurrency,
        };
      }
    }
    return out;
  }

  if (!single) return { error: "order or orders is required" };
  const row = await findOrderForAccount(u.accountId, single);
  if (!row) return { error: "Incorrect order ID" };

  return {
    charge: Number(row.charge ?? 0).toFixed(4),
    start_count: Number(row.start_count ?? 0),
    status: normalizeStatus(String(row.status ?? "pending")),
    remains: Number(row.remains ?? 0),
    currency: u.panelCurrency,
  };
}

async function handleRefill(u: ApiUser, params: Record<string, string>) {
  const ref = (params.order || "").trim();
  if (!ref) return { error: "order is required" };
  const order = await findOrderForAccount(u.accountId, ref);
  if (!order) return { error: "Incorrect order ID" };
  if (!order.provider_id || !order.provider_order_id) return { error: "Order has no provider mapping" };

  const admin = createAdminClient();
  const { data: prov } = await admin
    .from("providers")
    .select("api_url")
    .eq("id", order.provider_id)
    .maybeSingle();
  if (!prov) return { error: "Provider not found" };

  try {
    const creds = await getProviderCredentials(String(order.provider_id), String(prov.api_url));
    return await refillOrder(creds, String(order.provider_order_id));
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Refill failed" };
  }
}

async function handleCancel(u: ApiUser, params: Record<string, string>) {
  const refs = (params.orders || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!refs.length) return { error: "orders is required" };

  const admin = createAdminClient();
  const rows: Array<{ ref: string; id: string; provider_id: string | null; provider_order_id: string | null }> = [];
  for (const ref of refs) {
    const o = await findOrderForAccount(u.accountId, ref);
    if (!o) continue;
    rows.push({ ref, id: String(o.id), provider_id: (o.provider_id as string | null) ?? null, provider_order_id: (o.provider_order_id as string | null) ?? null });
  }

  const byProvider = new Map<string, Array<{ ref: string; id: string; providerOrderId: string }>>();
  const out: Array<{ order: string; cancel: number | { error: string } }> = [];

  for (const r of rows) {
    if (!r.provider_id || !r.provider_order_id) {
      out.push({ order: r.ref, cancel: { error: "Order has no provider mapping" } });
      continue;
    }
    const arr = byProvider.get(r.provider_id) ?? [];
    arr.push({ ref: r.ref, id: r.id, providerOrderId: r.provider_order_id });
    byProvider.set(r.provider_id, arr);
  }

  for (const [providerId, items] of byProvider.entries()) {
    const { data: prov } = await admin
      .from("providers")
      .select("api_url")
      .eq("id", providerId)
      .maybeSingle();
    if (!prov) {
      for (const it of items) out.push({ order: it.ref, cancel: { error: "Provider not found" } });
      continue;
    }

    try {
      const creds = await getProviderCredentials(providerId, String(prov.api_url));
      const resp = await cancelOrders(creds, items.map((i) => i.providerOrderId));
      if (!Array.isArray(resp)) {
        for (const it of items) out.push({ order: it.ref, cancel: { error: (resp as { error?: string }).error ?? "Cancel failed" } });
        continue;
      }

      for (const it of items) {
        const match = resp.find((r) => String(r.order) === it.providerOrderId);
        if (!match) {
          out.push({ order: it.ref, cancel: { error: "Cancel response missing" } });
          continue;
        }
        out.push({ order: it.ref, cancel: match.cancel });
        if (match.cancel === 1) {
          await admin.from("orders").update({ status: "canceled" }).eq("id", it.id);
          await addHistory(it.id, "canceled", "Canceled via customer API");
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Cancel failed";
      for (const it of items) out.push({ order: it.ref, cancel: { error: msg } });
    }
  }

  for (const ref of refs) {
    if (!out.some((x) => x.order === ref)) out.push({ order: ref, cancel: { error: "Incorrect order ID" } });
  }

  return out;
}

async function process(req: NextRequest) {
  const params = await parseParams(req);
  const action = (params.action || "").trim().toLowerCase();
  const key = (params.key || "").trim();

  if (!key) return NextResponse.json({ error: "API key is required" }, { status: 400 });
  if (!action) return NextResponse.json({ error: "action is required" }, { status: 400 });

  const u = await loadUserByKey(key);
  if (!u) return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  if (!u.apiEnabled) return NextResponse.json({ error: "Customer API is disabled for this panel" }, { status: 403 });
  if (u.accountStatus !== "active") return NextResponse.json({ error: "Account cannot use API right now" }, { status: 403 });

  if (action === "services") return NextResponse.json(await handleServices(u));
  if (action === "balance") return NextResponse.json({ balance: u.balance.toFixed(4), currency: u.panelCurrency });
  if (action === "add") return NextResponse.json(await handleAdd(u, params));
  if (action === "add_multiple" || action === "addmany" || action === "bulk_add") {
    return NextResponse.json(await handleAddMultiple(u, params));
  }
  if (action === "status") return NextResponse.json(await handleStatus(u, params));
  if (action === "refill") return NextResponse.json(await handleRefill(u, params));
  if (action === "cancel") return NextResponse.json(await handleCancel(u, params));

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function GET(req: NextRequest) {
  return process(req);
}

export async function POST(req: NextRequest) {
  return process(req);
}
