"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { createClient } from "@/src/lib/supabase/client";
import PreviewSwitcher from "./PreviewSwitcher";

const PublicLanding = dynamic(
  () => import("@/src/components/panels").then((m) => m.PublicLanding),
  { ssr: false }
);
const AuthScreen = dynamic(
  () => import("@/src/components/panels").then((m) => m.AuthScreen),
  { ssr: false }
);
const InnvilApp = dynamic(
  () => import("@/src/components/panels").then((m) => m.InnvilApp),
  {
    ssr: false,
    loading: () => <div className="fp-root min-h-screen fp-grid-bg" />,
  }
);

/* =========================================================
   ROOT — real, auth-driven.
   Signed out → public site / login. Signed in → dashboard.
   Dev world-switcher is available at "/?preview=1".
   ========================================================= */

type View = "loading" | "public" | "auth" | "app" | "preview";

export default function Home() {
  const [view, setView] = useState<View>("loading");

  useEffect(() => {
    // Dev escape hatch: the old world-switcher harness.
    if (new URLSearchParams(window.location.search).get("preview") === "1") {
      setView("preview");
      return;
    }
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setView(data.user ? "app" : "public"));
  }, []);

  // Bridge the existing components' setWorld(...) calls to real views.
  const setWorld = (w: string) => {
    if (w === "public") setView("public");
    else if (w === "auth") setView("auth");
    else setView("app"); // "home"/"panels"/… → the real owner dashboard
  };

  if (view === "preview") return <PreviewSwitcher />;
  if (view === "loading") return <div className="fp-root min-h-screen fp-grid-bg" />;
  if (view === "public") return <PublicLanding setWorld={setWorld} />;
  if (view === "auth") return <AuthScreen setWorld={setWorld} />;
  return <InnvilApp setWorld={setWorld} initialSection="home" />;
}
