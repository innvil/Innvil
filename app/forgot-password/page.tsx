import type { Metadata } from "next";
import { getAuthProductContext } from "@/src/lib/auth/product-brand";
import { ForgotPasswordPageClient } from "@/src/components/auth/ForgotPasswordPageClient";

export async function generateMetadata(): Promise<Metadata> {
  const { brand } = await getAuthProductContext();
  return brand.logoSrc ? { icons: { icon: brand.logoSrc } } : {};
}

export default async function ForgotPasswordPage() {
  const { brand } = await getAuthProductContext();
  return <ForgotPasswordPageClient brand={brand} />;
}
