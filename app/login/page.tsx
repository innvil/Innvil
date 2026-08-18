import type { Metadata } from "next";
import { getAuthProductContext } from "@/src/lib/auth/product-brand";
import { LoginPageClient } from "@/src/components/auth/LoginPageClient";

export async function generateMetadata(): Promise<Metadata> {
  const { brand } = await getAuthProductContext();
  return brand.logoSrc ? { icons: { icon: brand.logoSrc } } : {};
}

export default async function LoginPage() {
  const { brand } = await getAuthProductContext();
  return <LoginPageClient brand={brand} />;
}
