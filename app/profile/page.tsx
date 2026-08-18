import type { Metadata } from "next";
import { User, Link2 } from "lucide-react";
import { requireWatchPage, getWatchShellContext } from "@/src/lib/watch-page";
import { getAccountTelegramIdentity, getPendingTelegramVerification, type AccountTelegramIdentity } from "@/src/lib/products/watch-abuse";
import { getAccountPreferences } from "@/src/lib/products/watch-account-preferences";
import { WatchShell } from "@/src/components/watch/WatchShell";
import { SectionHeader } from "@/src/components/watch/WatchUI";
import { ConnectTelegramCard } from "@/src/components/watch/ConnectTelegramCard";

export const metadata: Metadata = { title: "Profile — Innvil Watch", robots: { index: false }, icons: { icon: "/watch/app-tile.svg" } };

export default async function ProfilePage() {
  const { accountId, admin } = await requireWatchPage();
  const [shell, { data: userRes }, telegram, preferences] = await Promise.all([
    getWatchShellContext(admin, accountId),
    admin.auth.admin.getUserById(accountId),
    getAccountTelegramIdentity(admin, accountId),
    getAccountPreferences(admin, accountId),
  ]);
  const email = userRes.user?.email ?? null;

  let initialTelegramState: { status: "connected"; identity: AccountTelegramIdentity } | { status: "pending"; expiresAt: string } | { status: "not_connected" };
  if (telegram) {
    initialTelegramState = { status: "connected", identity: telegram };
  } else {
    const pending = await getPendingTelegramVerification(admin, accountId);
    initialTelegramState = pending ? { status: "pending", expiresAt: pending.expiresAt } : { status: "not_connected" };
  }

  return (
    <WatchShell active="profile" capacity={shell.capacity} attentionCount={shell.attentionCount}>
      <div className="space-y-6 max-w-2xl">
        <div>
          <h1 className="w-display text-xl mb-1">Profile</h1>
          <p className="text-sm w-text-dim">Manage your Innvil account identity and connected accounts.</p>
        </div>

        <div className="w-card p-5">
          <SectionHeader icon={User} title="Account" />
          <div className="text-sm">
            <p className="w-text-dim">Email</p>
            <p className="w-text mt-0.5">{email ?? "—"}</p>
          </div>
          <p className="text-xs w-text-faint mt-4">
            One Innvil account gives you access to Watch and other Innvil products you choose to use.
          </p>
        </div>

        <div className="w-card p-5">
          <SectionHeader icon={Link2} title="Connected identities" />
          <ConnectTelegramCard initial={initialTelegramState} preferences={preferences} />
        </div>
      </div>
    </WatchShell>
  );
}
