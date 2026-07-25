import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { headers } from "next/headers";
import { Lock, Wrench, FileText } from "lucide-react";
import { getPublicPanel, getStorefrontServices, getStorefrontPlatforms, getPanelPaymentMethods } from "@/src/lib/actions/storefront";
import { getCustomerAccount } from "@/src/lib/actions/customer-auth";
import type { PanelStatus } from "@/src/types/db";
import { themeVars } from "@/src/data/themes";
import { currencySymbol } from "@/src/lib/money";
import { getDesignPackage } from "@/src/data/designs";
import { DesignRenderer } from "@/src/components/design/DesignRenderer";
import { Storefront } from "./Storefront";

type Params = { params: Promise<{ subdomain: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { subdomain } = await params;
  const panel = await getPublicPanel(subdomain);
  if (!panel) return { title: "Panel not found", robots: { index: false, follow: false } };
  const title = `${panel.name} — Order social media services`;
  const description =
    panel.description ||
    `Buy followers, likes, views and more on ${panel.name}. Instant delivery, one wallet, transparent pricing.`;
  // Only browsable states get indexed; draft/suspended/maintenance are hidden.
  const indexable = panel.status === "live" || panel.status === "inactive";
  return {
    title,
    description,
    robots: indexable ? { index: true, follow: true } : { index: false, follow: false },
    // White-label: OG uses the PANEL's identity, never Innvil's.
    openGraph: { title, description, type: "website", siteName: panel.name },
    twitter: { card: "summary_large_image", title, description },
    ...(panel.favicon ? { icons: { icon: panel.favicon } } : {}),
  };
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="fp-root min-h-screen fp-grid-bg flex items-center justify-center px-4">
      <div className="text-center max-w-md">{children}</div>
    </div>
  );
}

function OfflineScreen({ status, name }: { status: PanelStatus; name: string }) {
  const cfg = {
    suspended: { icon: Lock, cls: "text-red-400 bg-red-500/10", title: "Panel Unavailable", body: `${name} is currently unavailable. Please check back later.` },
    maintenance: { icon: Wrench, cls: "fp-violet bg-[rgba(139,127,255,0.10)]", title: "Under Maintenance", body: `${name} is performing scheduled maintenance and will be back shortly.` },
    draft: { icon: FileText, cls: "fp-text-dim bg-[rgba(149,151,163,0.10)]", title: "Coming Soon", body: `${name} is still being set up. Please check back later.` },
  }[status as "suspended" | "maintenance" | "draft"];
  if (!cfg) return null;
  const Icon = cfg.icon;
  return (
    <Centered>
      <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 ${cfg.cls}`}>
        <Icon size={36} />
      </div>
      <h1 className="fp-display text-3xl mb-4">{cfg.title}</h1>
      <p className="fp-text-dim">{cfg.body}</p>
    </Centered>
  );
}

async function getApiBaseUrl(customDomain?: string | null): Promise<string> {
  if (customDomain) return `https://${customDomain}/api/v2`;

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host) return `${proto}://${host}/api/v2`;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  return `${appUrl ?? "http://localhost:3000"}/api/v2`;
}

export default async function StorefrontPage({ params }: Params) {
  const { subdomain } = await params;
  const panel = await getPublicPanel(subdomain);

  if (!panel) {
    return (
      <Centered>
        <h1 className="fp-display text-3xl mb-3">Panel not found</h1>
        <p className="fp-text-dim">No panel exists at this address.</p>
      </Centered>
    );
  }

  const themeStyle = themeVars(panel.theme, panel.accent) as CSSProperties;

  if (panel.status === "draft" || panel.status === "suspended" || panel.status === "maintenance") {
    return (
      <div style={themeStyle}>
        <OfflineScreen status={panel.status} name={panel.name} />
      </div>
    );
  }

  const [services, account, platformMeta, paymentMethods] = await Promise.all([
    getStorefrontServices(panel.id),
    getCustomerAccount(panel.id),
    getStorefrontPlatforms(panel.id),
    getPanelPaymentMethods(panel.id),
  ]);
  const apiBaseUrl = await getApiBaseUrl(panel.customDomain);

  /* A purchased marketplace design replaces the DEFAULT GUEST LANDING only. Signed-in
     customers always get the real dashboard, and the design's CTAs point at this
     panel's own auth routes — never Innvil's. */
  const designPkg = panel.activeDesign ? getDesignPackage(panel.activeDesign) : undefined;
  if (designPkg && !account) {
    const base = `/p/${panel.subdomain}`;
    const sym = currencySymbol(panel.currency);
    const prices = services.map((s) => s.price).filter((n) => Number.isFinite(n) && n > 0);
    return (
      <div style={themeStyle}>
        <DesignRenderer
          pkg={designPkg}
          page="landing"
          data={{
            panelName: panel.name,
            logoUrl: panel.logoUrl || undefined,
            currencySymbol: sym,
            services: services.slice(0, 12).map((s) => ({
              name: s.name,
              platform: s.platform ?? "other",
              price: s.price.toFixed(2),
              min: String(s.min),
            })),
            categories: Array.from(new Set(services.map((s) => s.category).filter((c): c is string => Boolean(c)))).slice(0, 6),
            liveStats: {
              services: String(services.length),
              platforms: String(new Set(services.map((s) => s.platform).filter(Boolean)).size),
              from: prices.length ? `${sym}${Math.min(...prices).toFixed(2)}` : undefined,
            },
          }}
          hrefs={{ signup: `${base}/signup`, login: `${base}/login`, services: "#services" }}
          slots={{
            "auth-card": (
              <div style={{ display: "grid", gap: ".75rem", textAlign: "center" }}>
                <p className="dz-dim" style={{ margin: 0, fontSize: ".95rem" }}>
                  Create your account to add funds and place your first order.
                </p>
                <a href={`${base}/signup`} className="dz-btn dz-btn-primary" style={{ justifyContent: "center" }}>
                  Create account
                </a>
                <a href={`${base}/login`} className="dz-dim" style={{ fontSize: ".85rem", textDecoration: "none" }}>
                  Already have an account? Log in
                </a>
              </div>
            ),
          }}
        />
      </div>
    );
  }

  return (
    <div style={themeStyle}>
      <Storefront
        panel={{ id: panel.id, subdomain: panel.subdomain, name: panel.name, status: panel.status, currency: panel.currency, logoUrl: panel.logoUrl, headline: panel.headline, description: panel.description, sections: panel.sections, aiSupport: panel.aiSupport, dashboardLayout: panel.dashboardLayout }}
        services={services}
        initialAccount={account}
        platformMeta={platformMeta}
        paymentMethods={paymentMethods}
        apiBaseUrl={apiBaseUrl}
      />
    </div>
  );
}
