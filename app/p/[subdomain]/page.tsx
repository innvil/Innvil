import type { Metadata } from "next";
import { Lock, Wrench, FileText } from "lucide-react";
import { getPublicPanel, getStorefrontServices, getStorefrontPlatforms } from "@/src/lib/actions/storefront";
import { getCustomerAccount } from "@/src/lib/actions/customer-auth";
import { listCustomerOrders } from "@/src/lib/actions/orders";
import { listDeposits } from "@/src/lib/actions/payments";
import type { PanelStatus } from "@/src/types/db";
import { Storefront } from "./Storefront";

type Params = { params: Promise<{ subdomain: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { subdomain } = await params;
  const panel = await getPublicPanel(subdomain);
  if (!panel) return { title: "Panel not found" };
  return {
    title: `${panel.name} — Order social media services`,
    description: `Buy followers, likes, views and more on ${panel.name}. Instant delivery, one wallet, transparent pricing.`,
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

  if (panel.status === "draft" || panel.status === "suspended" || panel.status === "maintenance") {
    return <OfflineScreen status={panel.status} name={panel.name} />;
  }

  const [services, account, platformMeta] = await Promise.all([
    getStorefrontServices(panel.id),
    getCustomerAccount(panel.id),
    getStorefrontPlatforms(panel.id),
  ]);
  // Only signed-in customers have orders/deposits; skip the queries for guests.
  const [orders, deposits] = account
    ? await Promise.all([listCustomerOrders(panel.id), listDeposits(panel.id)])
    : [[], []];

  return (
    <Storefront
      panel={{ id: panel.id, name: panel.name, status: panel.status }}
      services={services}
      initialAccount={account}
      initialOrders={orders}
      initialDeposits={deposits}
      platformMeta={platformMeta}
    />
  );
}
