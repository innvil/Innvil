"use server";

import { getAuthedAdmin } from "@/src/lib/auth";

/* Per-owner business details for earnings receipts. Owners edit them by hand or
   auto-fill from an uploaded registration doc (OCR is client-side; the doc is
   never uploaded/stored). Reads/writes are owner-scoped via the service role. */

export interface BusinessProfile {
  legalName: string;
  address: string;
  registrant: string;
  businessNumber: string;
  taxId: string;
  email: string;
  phone: string;
}

const EMPTY: BusinessProfile = {
  legalName: "", address: "", registrant: "", businessNumber: "", taxId: "", email: "", phone: "",
};

type Result = { ok: true } | { ok: false; error: string };

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export async function getBusinessProfile(): Promise<BusinessProfile> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return EMPTY;
  const { data } = await admin
    .from("owner_business_profiles")
    .select("legal_name, address, registrant, business_number, tax_id, email, phone")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!data) return EMPTY;
  return {
    legalName: str(data.legal_name),
    address: str(data.address),
    registrant: str(data.registrant),
    businessNumber: str(data.business_number),
    taxId: str(data.tax_id),
    email: str(data.email),
    phone: str(data.phone),
  };
}

export async function saveBusinessProfile(p: BusinessProfile): Promise<Result> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };

  const clip = (v: string, n = 300) => str(v).trim().slice(0, n);
  const row = {
    owner_id: user.id,
    legal_name: clip(p.legalName),
    address: clip(p.address, 500),
    registrant: clip(p.registrant),
    business_number: clip(p.businessNumber, 100),
    tax_id: clip(p.taxId, 100),
    email: clip(p.email, 200),
    phone: clip(p.phone, 60),
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from("owner_business_profiles").upsert(row, { onConflict: "owner_id" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
