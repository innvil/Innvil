"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import PreviewSwitcher from "./PreviewSwitcher";

/* Client island for the signed-in owner app + the dev preview switcher. Kept out
   of the server landing so the marketing page stays SSR/crawlable. The app is
   auth-gated (not SEO-relevant), so it loads client-only (ssr:false). */

const InnvilApp = dynamic(
  () => import("@/src/components/panels").then((m) => m.InnvilApp),
  { ssr: false, loading: () => <div className="fp-root min-h-screen fp-grid-bg" /> }
);

export default function HomeClient({ mode }: { mode: "preview" | "app" }) {
  const router = useRouter();

  if (mode === "preview") return <PreviewSwitcher />;

  // On logout the app calls setWorld("public"); re-run the server component so the
  // signed-out marketing landing is served (getUser() will now be null).
  const setWorld = (w: string) => {
    if (w === "public") router.refresh();
  };

  return <InnvilApp setWorld={setWorld} initialSection="home" />;
}
