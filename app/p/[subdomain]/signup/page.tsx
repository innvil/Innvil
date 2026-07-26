import type { Metadata } from "next";
import Link from "next/link";
import { getPublicPanel } from "@/src/lib/actions/storefront";
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

  return (
    <SignUpClient
      panelId={panel.id}
      panelName={panel.name}
      subdomain={panel.subdomain}
      logoUrl={panel.logoUrl}
    />
  );
}
