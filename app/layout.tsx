import type { Metadata } from "next";
import { Fraunces, Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

// NOTE: no `title.template` on purpose — storefronts are white-label and must not
// inherit an "· Innvil" suffix. Each route sets its own absolute title.
export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://innvil.cloud"),
  title: "Innvil — The White-label SMM Panel Builder",
  description: "Build your own white-label SMM panel. Create as many independent panels as you want, each with its own subdomain, storefront, customer dashboard, and wallet. 5% commission only — no monthly rent.",
  keywords: ["white-label smm panel builder", "white-label smm panel building", "create smm panel", "how to start an smm panel", "start your own smm panel", "smm panel builder", "smm panel script alternative", "smm panel software", "no-code smm panel builder", "smm reseller panel"],
  applicationName: "Innvil",
  authors: [{ name: "Innvil" }],
  icons: { icon: "/favicon.svg" },
  robots: { index: true, follow: true },
  openGraph: {
    // NOTE: no `url` here — it would resolve to the Innvil apex for EVERY route,
    // including white-label storefronts. Set per-page instead.
    title: "Innvil — The White-label SMM Panel Builder",
    description: "Build your own white-label SMM panel. 5% commission on completed orders only — no monthly rent.",
    type: "website",
    siteName: "Innvil",
  },
  twitter: {
    card: "summary_large_image",
    title: "Innvil — The White-label SMM Panel Builder",
    description: "Build your own white-label SMM panel. 5% commission only — no monthly rent.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${fraunces.variable} ${inter.variable} ${ibmPlexMono.variable}`}>
      <body suppressHydrationWarning className="fp-root min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
