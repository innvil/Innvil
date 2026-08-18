import type { Metadata } from "next";
import { User, Link2, CheckCircle2 } from "lucide-react";
import { requireWatchPage, getWatchShellContext } from "@/src/lib/watch-page";
import { getAccountTelegramIdentity } from "@/src/lib/products/watch-abuse";
import { WatchShell } from "@/src/components/watch/WatchShell";
import { SectionHeader } from "@/src/components/watch/WatchUI";
import { CopyIdButton } from "@/src/components/watch/CopyIdButton";

export const metadata: Metadata = { title: "Profile — Innvil Watch", robots: { index: false }, icons: { icon: "/watch/app-tile.svg" } };

export default async function ProfilePage() {
  const { accountId, admin } = await requireWatchPage();
  const [shell, { data: userRes }, telegram] = await Promise.all([
    getWatchShellContext(admin, accountId),
    admin.auth.admin.getUserById(accountId),
    getAccountTelegramIdentity(admin, accountId),
  ]);
  const email = userRes.user?.email ?? null;

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
          {!telegram ? (
            <p className="text-sm w-text-faint py-2">No connected accounts yet.</p>
          ) : (
            <div className="w-surface-raised border w-line-soft rounded-lg p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-1">Telegram</p>
                  <p className="w-text text-sm">Telegram account</p>
                </div>
                <span className="inline-flex items-center gap-1.5 text-xs w-green">
                  <CheckCircle2 size={13} /> Verified
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t w-line-soft">
                <div>
                  <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-0.5">Telegram ID</p>
                  <p className="w-mono text-xs w-text-dim break-all">{telegram.telegramUserId}</p>
                </div>
                <CopyIdButton value={String(telegram.telegramUserId)} label="Telegram ID" />
              </div>
              <p className="text-xs w-text-faint mt-3">
                Your verified Telegram account is linked to your Innvil account, so it can be securely connected to
                Innvil Watch.
              </p>
            </div>
          )}
        </div>
      </div>
    </WatchShell>
  );
}
