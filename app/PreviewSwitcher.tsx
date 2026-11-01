"use client";

import { useState } from "react";
import { PublicLanding } from "@/src/components/panels/PublicLanding";
import {
  AuthScreen,
  InnvilApp,
  SuperAdmin,
} from "@/src/components/panels";
import { CustomerPanel } from "@/src/components/customer";

/* =========================================================
   DEV PREVIEW WORLD SWITCHER — reachable at "/?preview=1".
   Lets you jump between every surface (incl. the mock customer
   view + Super Admin) without auth. Not shown to real users.
   ========================================================= */

export default function PreviewSwitcher() {
  const [world, setWorld] = useState("public");

  const worlds = [
    { k: "public", label: "Innvil · Public site" },
    { k: "auth", label: "Innvil · Login/Signup" },
    { k: "home", label: "Innvil · Dashboard home" },
    { k: "panels", label: "Innvil · My Panels" },
    { k: "create", label: "Innvil · Create Panel" },
    { k: "billing", label: "Innvil · Billing" },
    { k: "live", label: "Created panel · Customer-facing (mock)" },
    { k: "admin", label: "Super Admin (you) — separate" },
  ];

  return (
    <div className="fp-root">
      {world === "public" && <PublicLanding setWorld={setWorld} />}
      {world === "auth" && <AuthScreen setWorld={setWorld} />}
      {(world === "home" || world === "panels" || world === "create" || world === "billing") && (
        <InnvilApp key={world} setWorld={setWorld} initialSection={world} />
      )}
      {world === "live" && <CustomerPanel previewControls />}
      {world === "admin" && <SuperAdmin />}

      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 fp-panel-raised border border-dashed border-[#262A35] rounded-full px-2 py-1.5 flex items-center gap-1 shadow-2xl max-w-[92vw] overflow-x-auto">
        <span className="fp-text-faint text-[10px] fp-mono px-2 uppercase tracking-wide shrink-0">Preview</span>
        {worlds.map((w) => (
          <button
            key={w.k}
            onClick={() => setWorld(w.k)}
            className={`text-[11px] px-3 py-1.5 rounded-full whitespace-nowrap shrink-0 transition-colors ${
              world === w.k ? "fp-gold-bg text-[#0A0B0F] font-semibold" : "fp-text-dim hover:fp-text"
            }`}
          >
            {w.label}
          </button>
        ))}
      </div>
    </div>
  );
}
