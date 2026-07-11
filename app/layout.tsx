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

export const metadata: Metadata = {
  title: "Veyra — The SMM Panel Maker",
  description: "Launch your own white-label SMM panel. Create as many independent panels as you want, each with its own subdomain, storefront, customer dashboard, and wallet. 5% commission only — no monthly rent.",
  keywords: ["SMM panel", "social media marketing", "panel maker", "white-label", "no-code"],
  authors: [{ name: "Veyra" }],
  openGraph: {
    title: "Veyra — The SMM Panel Maker",
    description: "Launch your own white-label SMM panel. 5% commission only.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable} ${ibmPlexMono.variable}`}>
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      </head>
      <body className="fp-root min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
