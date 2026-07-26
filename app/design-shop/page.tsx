import type { Metadata } from "next";
import { getUser } from "@/src/lib/auth";
import { listPanels } from "@/src/lib/actions/panels";
import { getDesignPricing } from "@/src/lib/actions/platform-settings";
import { MarketingHeader, MarketingFooter } from "@/src/components/marketing/SiteChrome";
import { designCards } from "@/src/data/designs";
import { DesignShop } from "@/src/components/design/DesignShop";

export const metadata: Metadata = {
  title: "Design Shop — Complete SMM Panel Landing Designs | Innvil",
  description:
    "Buy complete, professionally designed landing pages for your SMM panel — full layouts, artwork and animation, not colour presets. One-time purchase, yours forever, with a full live preview.",
  alternates: { canonical: "/design-shop" },
  openGraph: { title: "Innvil Design Shop", description: "Complete landing designs for your SMM panel.", url: "/design-shop", type: "website", siteName: "Innvil" },
};

/* Session-aware: signed-out visitors browse + preview; signed-in owners pick one of
   their panels and buy/activate right here (purchases are per-panel, charged from
   that panel's Innvil balance). */
export const dynamic = "force-dynamic";

export default async function DesignShopPage() {
  const user = await getUser();
  const [panels, pricing] = await Promise.all([
    user ? listPanels() : Promise.resolve([]),
    getDesignPricing(),
  ]);

  return (
    <div className="fp-root min-h-screen">
      <MarketingHeader signedIn={Boolean(user)} />
      <DesignShop
        cards={designCards()}
        pricing={pricing}
        signedIn={Boolean(user)}
        panels={panels.map((p) => ({ id: p.id, name: p.name }))}
      />
      <MarketingFooter />
    </div>
  );
}
