"use client";

import React, { useEffect, useState } from "react";
import { UserCircle2, Mail, Lock, CheckCircle2, AlertTriangle } from "lucide-react";
import { Card } from "@/src/components/ui";
import {
  getAccount, updateDisplayName, updateEmail, updatePassword, type AccountInfo,
} from "@/src/lib/actions/account";

type Msg = { text: string; error?: boolean } | null;

const inputCls =
  "w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5 text-sm mt-2 outline-none focus:fp-gold-border";

const ROLE_LABEL: Record<string, string> = {
  panel_owner: "Panel owner",
  super_admin: "Super admin",
  staff: "Staff",
  customer: "Customer",
};

function Feedback({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <p className={`text-xs mt-3 flex items-center gap-1.5 ${msg.error ? "text-red-400" : "fp-safe"}`}>
      {msg.error ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />} {msg.text}
    </p>
  );
}

export function AccountSettings() {
  const [account, setAccount] = useState<AccountInfo | null>(null);

  const [name, setName] = useState("");
  const [nameBusy, setNameBusy] = useState(false);
  const [nameMsg, setNameMsg] = useState<Msg>(null);

  const [email, setEmail] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMsg, setEmailMsg] = useState<Msg>(null);

  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<Msg>(null);

  useEffect(() => {
    getAccount().then((a) => {
      if (!a) return;
      setAccount(a);
      setName(a.displayName);
      setEmail(a.email ?? "");
    });
  }, []);

  const saveName = async () => {
    setNameBusy(true); setNameMsg(null);
    const res = await updateDisplayName(name);
    setNameMsg({ text: res.ok ? res.message ?? "Saved." : res.error, error: !res.ok });
    setNameBusy(false);
  };

  const saveEmail = async () => {
    setEmailBusy(true); setEmailMsg(null);
    const res = await updateEmail(email);
    setEmailMsg({ text: res.ok ? res.message ?? "Saved." : res.error, error: !res.ok });
    setEmailBusy(false);
  };

  const savePassword = async () => {
    setPwMsg(null);
    if (newPw !== confirmPw) { setPwMsg({ text: "New passwords don't match.", error: true }); return; }
    setPwBusy(true);
    const res = await updatePassword(curPw, newPw);
    if (res.ok) { setCurPw(""); setNewPw(""); setConfirmPw(""); }
    setPwMsg({ text: res.ok ? res.message ?? "Saved." : res.error, error: !res.ok });
    setPwBusy(false);
  };

  return (
    <div className="p-8 space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="fp-display text-2xl">Account settings</h1>
        {account && (
          <span className="text-xs fp-gold-soft-bg fp-gold px-2.5 py-1 rounded-full">
            {ROLE_LABEL[account.role] ?? account.role}
          </span>
        )}
      </div>

      <Card title="Profile" icon={UserCircle2}>
        <label className="fp-text-dim text-xs fp-mono uppercase">Username</label>
        <input value={name} onChange={(e) => setName(e.target.value)} name="username" autoComplete="section-innvil-owner username" placeholder="Your name" className={inputCls} />
        <div className="mt-4">
          <button onClick={saveName} disabled={nameBusy} className="fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60">
            {nameBusy ? "Saving…" : "Save username"}
          </button>
        </div>
        <Feedback msg={nameMsg} />
      </Card>

      <Card title="Email" icon={Mail}>
        <label className="fp-text-dim text-xs fp-mono uppercase">Email address</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" name="email" autoComplete="section-innvil-owner email" placeholder="you@example.com" className={`${inputCls} fp-mono`} />
        <p className="fp-text-faint text-xs mt-2">Changing this sends a confirmation link to the new address — it applies only after you confirm.</p>
        <div className="mt-4">
          <button onClick={saveEmail} disabled={emailBusy} className="fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60">
            {emailBusy ? "Saving…" : "Update email"}
          </button>
        </div>
        <Feedback msg={emailMsg} />
      </Card>

      <Card title="Password" icon={Lock}>
        <label className="fp-text-dim text-xs fp-mono uppercase">Current password</label>
        <input value={curPw} onChange={(e) => setCurPw(e.target.value)} type="password" name="current-password" autoComplete="section-innvil-owner current-password" className={inputCls} />
        <label className="fp-text-dim text-xs fp-mono uppercase mt-4 block">New password</label>
        <input value={newPw} onChange={(e) => setNewPw(e.target.value)} type="password" name="new-password" autoComplete="section-innvil-owner new-password" className={inputCls} />
        <label className="fp-text-dim text-xs fp-mono uppercase mt-4 block">Confirm new password</label>
        <input value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} type="password" name="confirm-password" autoComplete="section-innvil-owner new-password" className={inputCls} />
        <div className="mt-4">
          <button onClick={savePassword} disabled={pwBusy} className="fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60">
            {pwBusy ? "Saving…" : "Change password"}
          </button>
        </div>
        <Feedback msg={pwMsg} />
      </Card>
    </div>
  );
}
