import "server-only";

/* =========================================================
   Vercel Domains API (custom domains) — server only.
   Adds/verifies/removes a panel's custom domain on THIS Vercel project so Vercel
   routes it here and issues an SSL cert. Best-effort: if the env isn't set, the
   caller still stores the domain and shows manual DNS instructions.
   Requires: VERCEL_API_TOKEN, VERCEL_PROJECT_ID (+ optional VERCEL_TEAM_ID).
   Docs: https://vercel.com/docs/rest-api/endpoints/projects#add-a-domain-to-a-project
   ========================================================= */

export interface DomainVerification {
  type: string;   // "TXT" | "CNAME" | "A" | …
  domain: string; // the record host
  value: string;  // the record value
  reason?: string;
}
export interface DomainStatus {
  ok: boolean;
  verified: boolean;
  misconfigured?: boolean;
  verification: DomainVerification[];
  error?: string;
}

const API = "https://api.vercel.com";

export function vercelConfigured(): boolean {
  return !!(process.env.VERCEL_API_TOKEN?.trim() && process.env.VERCEL_PROJECT_ID?.trim());
}

function ctx() {
  const token = process.env.VERCEL_API_TOKEN?.trim() || "";
  const project = process.env.VERCEL_PROJECT_ID?.trim() || "";
  const team = process.env.VERCEL_TEAM_ID?.trim() || "";
  const q = team ? `?teamId=${encodeURIComponent(team)}` : "";
  return { token, project, team, q };
}

async function call(path: string, init: RequestInit): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const { token } = ctx();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: res.status, json };
}

/** Add the domain to the project. Idempotent-ish: an existing domain is treated ok. */
export async function addProjectDomain(domain: string): Promise<DomainStatus> {
  if (!vercelConfigured()) return { ok: false, verified: false, verification: [], error: "Vercel API not configured" };
  const { project, q } = ctx();
  const { status, json } = await call(`/v10/projects/${project}/domains${q}`, {
    method: "POST",
    body: JSON.stringify({ name: domain }),
  });
  // 409 = already assigned to this project → fine; fall through to a status check.
  if (status >= 400 && status !== 409) {
    const err = (json?.error as { message?: string } | undefined)?.message;
    return { ok: false, verified: false, verification: [], error: err ?? `Vercel error (${status})` };
  }
  return getProjectDomain(domain);
}

/** Current verification/config status for a project domain. */
export async function getProjectDomain(domain: string): Promise<DomainStatus> {
  if (!vercelConfigured()) return { ok: false, verified: false, verification: [], error: "Vercel API not configured" };
  const { project, q } = ctx();
  const { status, json } = await call(`/v9/projects/${project}/domains/${encodeURIComponent(domain)}${q}`, { method: "GET" });
  if (status >= 400 || !json) {
    const err = (json?.error as { message?: string } | undefined)?.message;
    return { ok: false, verified: false, verification: [], error: err ?? `Vercel error (${status})` };
  }
  const verification = Array.isArray(json.verification)
    ? (json.verification as DomainVerification[]).map((v) => ({ type: v.type, domain: v.domain, value: v.value, reason: v.reason }))
    : [];
  // Also fetch config to know if DNS is pointed correctly (misconfigured flag).
  let misconfigured: boolean | undefined;
  try {
    const cfg = await call(`/v6/domains/${encodeURIComponent(domain)}/config${q}`, { method: "GET" });
    if (cfg.json && typeof cfg.json.misconfigured === "boolean") misconfigured = cfg.json.misconfigured;
  } catch { /* best-effort */ }
  return { ok: true, verified: json.verified === true, misconfigured, verification };
}

export async function removeProjectDomain(domain: string): Promise<{ ok: boolean; error?: string }> {
  if (!vercelConfigured()) return { ok: true }; // nothing to remove remotely
  const { project, q } = ctx();
  const { status, json } = await call(`/v9/projects/${project}/domains/${encodeURIComponent(domain)}${q}`, { method: "DELETE" });
  if (status >= 400 && status !== 404) {
    const err = (json?.error as { message?: string } | undefined)?.message;
    return { ok: false, error: err ?? `Vercel error (${status})` };
  }
  return { ok: true };
}
