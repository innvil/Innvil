import type { Metadata } from "next";
import { getAuthProductContext } from "@/src/lib/auth/product-brand";
import { ResetPasswordPageClient } from "@/src/components/auth/ResetPasswordPageClient";

export async function generateMetadata(): Promise<Metadata> {
  const { brand } = await getAuthProductContext();
  return brand.logoSrc ? { icons: { icon: brand.logoSrc } } : {};
}

export default async function ResetPasswordPage() {
  const { brand } = await getAuthProductContext();
  return <ResetPasswordPageClient brand={brand} />;
}
