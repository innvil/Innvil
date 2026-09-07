import type { Metadata } from "next";
import { getAuthProductContext, authPageMetadata } from "@/src/lib/auth/product-brand";
import { LoginPageClient } from "@/src/components/auth/LoginPageClient";

export async function generateMetadata(): Promise<Metadata> {
  const { brand } = await getAuthProductContext();
  return authPageMetadata(brand, "/login");
}

export default async function LoginPage() {
  const { brand } = await getAuthProductContext();
  return <LoginPageClient brand={brand} />;
}
