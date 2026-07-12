"use client";

import React from "react";
import Link from "next/link";
import { InnvilBrandMark } from "@/src/components/ui/BrandMark";

/** Full-screen centered shell every auth "world" (login/signup/reset) shares. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="fp-root min-h-screen fp-noise fp-grid-bg flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/" className="flex items-center gap-2.5 mb-8 justify-center">
          <div className="w-10 h-10 rounded-[9px] bg-[#C9A574] flex items-center justify-center">
            <InnvilBrandMark className="w-[109%] h-[107%] -translate-x-[1px] text-[#0E1522]" />
          </div>
          <span className="fp-display text-lg">Innvil</span>
        </Link>
        <div className="fp-panel border fp-line rounded-2xl p-7">
          <h1 className="fp-display text-xl">{title}</h1>
          {subtitle && <p className="fp-text-dim text-sm mt-1 mb-5">{subtitle}</p>}
          {!subtitle && <div className="mb-5" />}
          {children}
        </div>
        {footer && <div className="text-center mt-5 fp-text-faint text-xs">{footer}</div>}
      </div>
    </div>
  );
}

export const authInputCls =
  "w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5 text-sm mt-2 outline-none focus:fp-gold-border";
