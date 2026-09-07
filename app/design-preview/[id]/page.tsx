import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDesignPackage, getDesignMeta, PUBLISHED_DESIGNS } from "@/src/data/designs";
import { DesignPreviewShell } from "@/src/components/design/DesignPreviewShell";

/* Full live preview for a marketplace design. Only PUBLISHED designs have a package
   to render; teasers show an "available soon" notice. Kept out of search results —
   this is a product surface, not marketing content. */

export const metadata: Metadata = { robots: { index: false, follow: false } };

export function generateStaticParams() {
  return PUBLISHED_DESIGNS.map((d) => ({ id: d.meta.id }));
}

export default async function DesignPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pkg = getDesignPackage(id);

  if (!pkg) {
    const meta = getDesignMeta(id);
    if (!meta) notFound();
    return (
      <div className="fp-root min-h-screen fp-grid-bg flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-2xl mx-auto mb-5" style={{ background: meta.cover.background }} />
          <h1 className="fp-display text-2xl mb-2">{meta.name}</h1>
          <p className="fp-text-dim text-sm mb-1">{meta.tagline}</p>
          <p className="fp-text-faint text-xs mb-6">
            This design is still in the studio. We finish and publish one design at a time, so every
            release gets a complete build and a full live preview.
          </p>
          <Link href="/design-shop" className="fp-btn-primary text-sm font-semibold px-5 py-2.5 rounded-lg">Back to Design Shop</Link>
        </div>
      </div>
    );
  }

  return <DesignPreviewShell pkg={pkg} />;
}
