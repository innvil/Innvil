import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — Innvil",
  description: "How Innvil collects, uses, and protects your information.",
};

/* Placeholders to fill in after business registration:
   [COMPANY] legal entity name · [ADDRESS] · [CONTACT_EMAIL] · [EFFECTIVE_DATE] ·
   [JURISDICTION]. Have a lawyer review before relying on this. */

const UPDATED = "[EFFECTIVE_DATE]";

export default function PrivacyPage() {
  return (
    <div className="fp-root min-h-screen fp-grid-bg">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <Link href="/" className="fp-text-faint text-sm hover:fp-text">← Back to Innvil</Link>

        <h1 className="fp-display text-4xl mt-8 mb-2">Privacy Policy</h1>
        <p className="fp-text-faint text-sm mb-10">Last updated: {UPDATED}</p>

        <p className="fp-text-dim text-sm leading-relaxed mb-4">
          This Privacy Policy explains how [COMPANY] (&quot;Innvil,&quot; &quot;we,&quot; &quot;us&quot;)
          collects, uses, shares, and protects personal information when you use the Innvil platform,
          websites, dashboards, and APIs (the &quot;Platform&quot;). By using the Platform, you agree to
          this Policy.
        </p>

        <h2 className="fp-display text-xl mt-10 mb-3">1. Our role</h2>
        <p className="fp-text-dim text-sm leading-relaxed mb-4">
          Innvil is the controller of personal information about Panel Owners and visitors to our own
          website. For information that a Panel Owner&apos;s Customers submit on that Panel Owner&apos;s
          panel, the <strong>Panel Owner is the controller</strong> of that information and Innvil acts as
          a <strong>processor</strong> that stores and processes it on the Panel Owner&apos;s behalf.
          Panel Owners are responsible for providing their own privacy notice to their Customers.
        </p>

        <h2 className="fp-display text-xl mt-10 mb-3">2. Information we collect</h2>
        <ul className="list-disc pl-5 space-y-1.5 fp-text-dim text-sm mb-4">
          <li><strong>Account information</strong> — email address and an encrypted (hashed) password, and any display name you provide.</li>
          <li><strong>Panel and catalog data</strong> — panels you create, settings, branding, imported services, and pricing.</li>
          <li><strong>Transaction data</strong> — orders, wallet balances, deposits, and ledger records needed to operate the service and compute commission.</li>
          <li><strong>Support data</strong> — messages and tickets you send us.</li>
          <li><strong>Credentials you connect</strong> — Provider and Payment-Gateway API keys, which are stored <strong>encrypted</strong> and used only server-side; they are never exposed to browsers.</li>
          <li><strong>Technical data</strong> — IP address, device/browser information, log data, and session cookies used to keep you signed in and secure the service.</li>
        </ul>
        <p className="fp-text-dim text-sm leading-relaxed mb-4">
          We do not process card numbers or crypto private keys. Payments are handled by the Payment
          Gateways that Panel Owners connect.
        </p>

        <h2 className="fp-display text-xl mt-10 mb-3">3. How we use information</h2>
        <ul className="list-disc pl-5 space-y-1.5 fp-text-dim text-sm mb-4">
          <li>To provide, maintain, and secure the Platform and your account.</li>
          <li>To route orders to your connected Provider and reconcile wallet balances and deposits.</li>
          <li>To calculate and collect commission and to keep transaction records.</li>
          <li>To provide support and respond to your requests.</li>
          <li>To detect, prevent, and address fraud, abuse, and security issues.</li>
          <li>To comply with legal obligations and enforce our Terms.</li>
        </ul>

        <h2 className="fp-display text-xl mt-10 mb-3">4. Legal bases (where applicable, e.g. GDPR)</h2>
        <p className="fp-text-dim text-sm leading-relaxed mb-4">
          We process personal information as necessary to perform our contract with you, to pursue our
          legitimate interests in operating and securing the Platform, to comply with legal obligations,
          and, where required, with your consent.
        </p>

        <h2 className="fp-display text-xl mt-10 mb-3">5. How we share information</h2>
        <p className="fp-text-dim text-sm leading-relaxed mb-4">We share personal information only as needed:</p>
        <ul className="list-disc pl-5 space-y-1.5 fp-text-dim text-sm mb-4">
          <li><strong>Infrastructure and service providers</strong> that host and operate the Platform (for example, our database/authentication host and cloud hosting provider), under contracts that require appropriate protection.</li>
          <li><strong>Providers and Payment Gateways you connect</strong> — order and payment details are transmitted to fulfill and settle transactions you initiate.</li>
          <li><strong>Legal and safety</strong> — when required by law, legal process, or to protect rights, property, or safety.</li>
          <li><strong>Business transfers</strong> — in connection with a merger, acquisition, or sale of assets, subject to this Policy.</li>
        </ul>
        <p className="fp-text-dim text-sm leading-relaxed mb-4">We do not sell your personal information.</p>

        <h2 className="fp-display text-xl mt-10 mb-3">6. Cookies</h2>
        <p className="fp-text-dim text-sm leading-relaxed mb-4">
          We use essential cookies to keep you authenticated and to operate the Platform securely. These
          are required for the service to function.
        </p>

        <h2 className="fp-display text-xl mt-10 mb-3">7. Data retention</h2>
        <p className="fp-text-dim text-sm leading-relaxed mb-4">
          We retain personal information for as long as your account is active and as needed to provide
          the Platform, comply with legal, tax, and accounting obligations, resolve disputes, and enforce
          our agreements. Transaction records may be retained longer where required by law.
        </p>

        <h2 className="fp-display text-xl mt-10 mb-3">8. Security</h2>
        <p className="fp-text-dim text-sm leading-relaxed mb-4">
          We use technical and organizational measures to protect information, including encryption of
          connected API keys, access controls, and row-level data isolation between panels. No method of
          transmission or storage is completely secure, and we cannot guarantee absolute security.
        </p>

        <h2 className="fp-display text-xl mt-10 mb-3">9. International transfers</h2>
        <p className="fp-text-dim text-sm leading-relaxed mb-4">
          Your information may be processed in countries other than your own. Where required, we rely on
          appropriate safeguards for such transfers.
        </p>

        <h2 className="fp-display text-xl mt-10 mb-3">10. Your rights</h2>
        <p className="fp-text-dim text-sm leading-relaxed mb-4">
          Depending on your location, you may have rights to access, correct, delete, restrict, or object
          to processing of your personal information, and to data portability. To exercise these rights,
          contact us at [CONTACT_EMAIL]. If you are a Customer of a specific panel, please also contact
          that Panel Owner, who is the controller of your information on their panel.
        </p>

        <h2 className="fp-display text-xl mt-10 mb-3">11. Children</h2>
        <p className="fp-text-dim text-sm leading-relaxed mb-4">
          The Platform is not directed to individuals under 18, and we do not knowingly collect their
          personal information.
        </p>

        <h2 className="fp-display text-xl mt-10 mb-3">12. Changes to this Policy</h2>
        <p className="fp-text-dim text-sm leading-relaxed mb-4">
          We may update this Policy from time to time. Changes will be posted here with a new date and,
          where required, notified to you.
        </p>

        <h2 className="fp-display text-xl mt-10 mb-3">13. Contact</h2>
        <p className="fp-text-dim text-sm leading-relaxed mb-10">
          [COMPANY]{" "}
          <br />[ADDRESS]
          <br />[CONTACT_EMAIL]
        </p>

        <div className="border-t fp-line-soft pt-6 flex items-center justify-between fp-text-faint text-xs">
          <span>© 2026 Innvil</span>
          <Link href="/terms" className="hover:fp-text">Terms of Service →</Link>
        </div>
      </div>
    </div>
  );
}
