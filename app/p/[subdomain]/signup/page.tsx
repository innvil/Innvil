import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties } from "react";
import { getPublicPanel, getStorefrontServices } from "@/src/lib/actions/storefront";
import { getDesignPackage } from "@/src/data/designs";
import { getPage } from "@/src/lib/design/schema";
import { DesignRenderer } from "@/src/components/design/DesignRenderer";
import { themeToDesignTokens } from "@/src/lib/design/theme-bridge";
import { storefrontBase } from "@/src/lib/storefront-host";
import { themeVars } from "@/src/data/themes";
import { currencySymbol } from "@/src/lib/money";
import { SignUpClient } from "./SignUpClient";

type Params = { params: Promise<{ subdomain: string }> };

/* White-label: panel's own title + favicon, never Innvil's. */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { subdomain } = await params;
  const panel = await getPublicPanel(subdomain);
  if (!panel) return { title: "Panel not found", robots: { index: false, follow: false } };
  return {
    title: `Create account — ${panel.name}`,
    description: `Create your ${panel.name} account to start ordering.`,
    robots: { index: false, follow: false },
    openGraph: { title: `Create account — ${panel.name}`, type: "website", siteName: panel.name },
    ...(panel.favicon ? { icons: { icon: panel.favicon } } : {}),
  };
}

export default async function StorefrontSignUpPage({ params }: Params) {
  const { subdomain } = await params;
  const panel = await getPublicPanel(subdomain);

  if (!panel) {
    return (
      <div className="fp-root min-h-screen fp-grid-bg flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <h1 className="fp-display text-3xl mb-3">Panel not found</h1>
          <p className="fp-text-dim mb-6">No panel exists at this address.</p>
          <Link href="/" className="fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg">Back home</Link>
        </div>
      </div>
    );
  }

  const form = (
    <SignUpClient
      panelId={panel.id}
      panelName={panel.name}
      subdomain={panel.subdomain}
      logoUrl={panel.logoUrl}
    />
  );

  /* If the panel has a purchased design that includes a signup page, render THAT via the
     shared renderer, injecting the real signup form into its auth slot — so the page
     matches the design instead of the Innvil default. */
  const pkg = panel.activeDesign ? getDesignPackage(panel.activeDesign) : undefined;
  if (pkg && getPage(pkg, "signup")) {
    const base = await storefrontBase(panel.subdomain);
    const services = await getStorefrontServices(panel.id).catch(() => []);
    const platforms = new Set(services.map((s) => s.platform).filter(Boolean));
    const prices = services.map((s) => Number(s.price)).filter((n) => Number.isFinite(n) && n > 0);
    const sym = currencySymbol(panel.currency);

    return (
      <DesignRenderer
        pkg={pkg}
        page="signup"
        data={{
          panelName: panel.name,
          logoUrl: panel.logoUrl || undefined,
          services: services.slice(0, 6).map((s) => ({
            name: s.name,
            platform: s.platform ?? "other",
            price: Number(s.price).toFixed(2),
            min: String(s.min),
          })),
          categories: [],
          currencySymbol: sym,
          liveStats: {
            services: String(services.length),
            platforms: String(platforms.size),
            from: prices.length ? `${sym}${Math.min(...prices).toFixed(2)}` : undefined,
          },
        }}
        tokenOverrides={themeToDesignTokens(panel.theme, panel.accent)}
        hrefs={{
          signup: `${base}/signup`,
          login: `${base}/login`,
          services: base || "/",
        }}
        slots={{
          "auth-card": (
            <SignUpClient
              panelId={panel.id}
              panelName={panel.name}
              subdomain={panel.subdomain}
              logoUrl={panel.logoUrl}
              embedded
            />
          ),
        }}
      />
    );
  }

  // No design applied → the default themed signup page.
  return <div style={themeVars(panel.theme, panel.accent) as CSSProperties}>{form}</div>;
}
