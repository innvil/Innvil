"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useEffect } from "react";
import { DefaultLogo } from "@/src/components/ui/BrandMark";

/**
 * Password reset now happens entirely on the forgot-password page (branded OTP + new
 * password in one place — no email link). This route is kept only so old bookmarks
 * redirect there instead of 404-ing.
 */
export function ResetPasswordClient({ panelName, subdomain }: { panelName: string; subdomain: string }) {
  const router = useRouter();
  const forgotHref = `/p/${subdomain}/forgot-password`;
  useEffect(() => { router.replace(forgotHref); }, [router, forgotHref]);

  return (
    <div className="fp-root min-h-screen fp-grid-bg fp-noise flex items-center justify-center px-4 py-10">
      <div className="fp-panel border fp-line rounded-2xl p-7 w-full max-w-md text-center">
        <div className="flex items-center gap-2 mb-4 justify-center">
          <DefaultLogo className="w-8 h-8 rounded-lg" iconSize={16} />
          <p className="fp-display text-lg">{panelName}</p>
        </div>
        <p className="fp-text-dim text-sm mb-4">Taking you to password reset…</p>
        <Link href={forgotHref} className="fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg">Reset password</Link>
      </div>
    </div>
  );
}
