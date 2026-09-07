import type { Metadata } from "next";
import { getAuthProductContext, authPageMetadata } from "@/src/lib/auth/product-brand";
import { SignUpPageClient } from "@/src/components/auth/SignUpPageClient";

export async function generateMetadata(): Promise<Metadata> {
  const { brand } = await getAuthProductContext();
  return authPageMetadata(brand, "/signup");
}

export default async function SignUpPage() {
  const { brand } = await getAuthProductContext();
  return <SignUpPageClient brand={brand} />;
}
