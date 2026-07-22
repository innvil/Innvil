import { LANDING_FAQ } from "@/src/data/landing-faq";

/* Server-rendered structured data for the marketing landing (Organization,
   WebSite, SoftwareApplication, FAQPage). FAQ mirrors the visible accordion via
   the shared LANDING_FAQ, which is what Google requires for FAQ rich results. */

const SITE = (process.env.NEXT_PUBLIC_APP_URL || "https://innvil.cloud").replace(/\/$/, "");

export function LandingJsonLd() {
  const graph = [
    {
      "@type": "Organization",
      "@id": `${SITE}/#organization`,
      name: "Innvil",
      url: SITE,
      logo: `${SITE}/favicon.svg`,
      description: "No-code white-label SMM panel builder.",
    },
    {
      "@type": "WebSite",
      "@id": `${SITE}/#website`,
      url: SITE,
      name: "Innvil",
      publisher: { "@id": `${SITE}/#organization` },
    },
    {
      "@type": "SoftwareApplication",
      name: "Innvil",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description: "Build your own white-label SMM panel — each with its own subdomain, storefront, customer dashboard and wallet.",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        description: "No monthly rent, no setup fee — 5% commission on completed orders only (drops to 1% at scale).",
      },
    },
    {
      "@type": "FAQPage",
      "@id": `${SITE}/#faq`,
      mainEntity: LANDING_FAQ.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ];

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify({ "@context": "https://schema.org", "@graph": graph }) }}
    />
  );
}
