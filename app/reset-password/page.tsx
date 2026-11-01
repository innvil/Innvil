import type { Metadata } from "next";
import { getAuthProductContext, authPageMetadata } from "@/src/lib/auth/product-brand";
import { ResetPasswordPageClient } from "@/src/components/auth/ResetPasswordPageClient";

export async function generateMetadata(): Promise<Metadata> {
  const { brand } = await getAuthProductContext();
  return authPageMetadata(brand, "/reset-password");
}

export default async function ResetPasswordPage() {
  const { brand } = await getAuthProductContext();
  return <ResetPasswordPageClient brand={brand} />;
}
