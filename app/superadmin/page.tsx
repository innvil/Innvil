import { redirect } from "next/navigation";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { getUser } from "@/src/lib/auth";
import { amSuperAdmin } from "@/src/lib/actions/superadmin";
import { SuperAdminDashboard } from "@/src/components/superadmin/SuperAdminDashboard";

/* Super-admin control panel. Server-gated on the super_admin role. */

export const dynamic = "force-dynamic";

export default async function SuperAdminPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const allowed = await amSuperAdmin();
  if (!allowed) {
    return (
      <div className="fp-root min-h-screen fp-grid-bg flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-full bg-red-500/10 text-red-400 flex items-center justify-center mx-auto mb-5">
            <ShieldAlert size={30} />
          </div>
          <h1 className="fp-display text-2xl mb-3">Restricted</h1>
          <p className="fp-text-dim text-sm mb-6">This area is for Innvil super admins only.</p>
          <Link href="/" className="fp-btn-primary text-sm font-semibold px-5 py-2.5 rounded-lg">Back to dashboard</Link>
        </div>
      </div>
    );
  }

  return <SuperAdminDashboard />;
}
