import type { Metadata } from "next";
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

export default function DesignShopPage() {
  return (
    <div className="fp-root min-h-screen">
      <MarketingHeader />
      <DesignShop cards={designCards()} />
      <MarketingFooter />
    </div>
  );
}
