"use client";

import React from "react";
import Link from "next/link";
import { InnvilBrandMark } from "@/src/components/ui/BrandMark";
import type { AuthBrand } from "@/src/lib/auth/product-brand";

/** Full-screen centered shell every auth "world" (login/signup/reset) shares.
 *  Presentation only -- switches design tokens/logo/copy per `brand`; the
 *  auth logic in every page that renders this is completely unchanged
 *  regardless of which brand is passed in. */
export function AuthShell({
  brand,
  title,
  subtitle,
  children,
  footer,
  note,
}: {
  brand: AuthBrand;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Small supporting line under the panel, e.g. Watch's
   *  "Your Innvil account works across Innvil products." */
  note?: React.ReactNode;
}) {
  return (
    <div className={`${brand.rootClass} flex items-center justify-center px-4 py-10`}>
      <div className="w-full max-w-sm">
        <Link href={brand.homeHref} className="flex items-center gap-2.5 mb-8 justify-center">
          {brand.logoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logoSrc} alt="" width={40} height={40} className="w-10 h-10 rounded-[9px]" />
          ) : (
            <div className="w-10 h-10 rounded-[9px] bg-[#C9A574] flex items-center justify-center">
              <InnvilBrandMark className="w-[109%] h-[107%] -translate-x-[1px] text-[#0E1522]" />
            </div>
          )}
          <div className="leading-tight text-left">
            <span className={`${brand.displayClass} text-lg block`}>{brand.name}</span>
            {brand.eyebrow && <span className={`${brand.textFaintClass} text-[10px]`}>{brand.eyebrow}</span>}
          </div>
        </Link>
        <div className={`${brand.panelClass} p-7`}>
          <h1 className={`${brand.displayClass} text-xl`}>{title}</h1>
          {subtitle && <p className={`${brand.textDimClass} text-sm mt-1 mb-5`}>{subtitle}</p>}
          {!subtitle && <div className="mb-5" />}
          {children}
        </div>
        {note && <p className={`${brand.textFaintClass} text-[11px] text-center mt-4`}>{note}</p>}
        {footer && <div className={`text-center mt-5 ${brand.textFaintClass} text-xs`}>{footer}</div>}
      </div>
    </div>
  );
}
