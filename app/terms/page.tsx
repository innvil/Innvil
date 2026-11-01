import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service — Innvil",
  description: "The terms that govern your use of the Innvil platform.",
};

/* Placeholders to fill in after business registration:
   [COMPANY] legal entity name · [JURISDICTION] governing law/venue ·
   [CONTACT_EMAIL] · [EFFECTIVE_DATE]. Have a lawyer review before relying on this. */

const UPDATED = "[EFFECTIVE_DATE]";

export default function TermsPage() {
  return (
    <div className="fp-root min-h-screen fp-grid-bg">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <Link href="/" className="fp-text-faint text-sm hover:fp-text">← Back to Innvil</Link>

        <h1 className="fp-display text-4xl mt-8 mb-2">Terms of Service</h1>
        <p className="fp-text-faint text-sm mb-10">Last updated: {UPDATED}</p>

        <p className="fp-text-dim text-sm leading-relaxed mb-4">
          These Terms of Service (&quot;Terms&quot;) are a binding agreement between you and
          [COMPANY] (&quot;Innvil,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) and
          govern your access to and use of the Innvil platform, websites, dashboards, APIs, and
          related services (together, the &quot;Platform&quot;). By creating an account or using
          the Platform, you agree to these Terms. If you do not agree, do not use the Platform.
        </p>

        <h2 className="fp-display text-xl mt-10 mb-3">1. What Innvil is (and is not)</h2>
        <p className="fp-text-dim text-sm leading-relaxed mb-4">
          Innvil is a no-code software platform that lets you (a &quot;Panel Owner&quot;) create and
          host white-label social-media-marketing (&quot;SMM&quot;) panels. Innvil provides the
          software, hosting, storefront, dashboards, wallet ledger, and order-routing tools.
        </p>
        <p className="fp-text-dim text-sm leading-relaxed mb-4">
          <strong>Innvil does not sell SMM services and is not an SMM service provider.</strong> Each
          Panel Owner connects their own third-party SMM provider (&quot;Provider&quot;). Orders
          placed on a panel are fulfilled by that Provider, not by Innvil. Innvil does not control,
          endorse, or guarantee any Provider, service quality, delivery time, or outcome.
        </p>

        <h2 className="fp-display text-xl mt-10 mb-3">2. Definitions</h2>
        <ul className="list-disc pl-5 space-y-1.5 fp-text-dim text-sm mb-4">
          <li><strong>Panel</strong> — a white-label SMM storefront created by a Panel Owner on the Platform.</li>
          <li><strong>Panel Owner</strong> — a user who creates and operates one or more Panels.</li>
          <li><strong>Customer</strong> — an end user who registers on a Panel to purchase services.</li>
          <li><strong>Provider</strong> — the third-party SMM API a Panel Owner connects to fulfill orders.</li>
          <li><strong>Payment Gateway</strong> — a third-party processor a Panel Owner connects to accept deposits.</li>
        </ul>

        <h2 className="fp-display text-xl mt-10 mb-3">3. Eligibility and accounts</h2>
        <p className="fp-text-dim text-sm leading-relaxed mb-4">
          You must be at least 18 years old and able to form a binding contract. You are responsible
          for the security of your account credentials and for all activity under your account. Keep
          your information accurate and notify us of any unauthorized use. We may refuse, suspend, or
          terminate accounts at our discretion, including for violation of these Terms.
        </p>

        <h2 className="fp-display text-xl mt-10 mb-3">4. Panel Owner responsibilities</h2>
        <p className="fp-text-dim text-sm leading-relaxed mb-4">As a Panel Owner, you are solely responsible for:</p>
        <ul className="list-disc pl-5 space-y-1.5 fp-text-dim text-sm mb-4">
          <li>Your relationship with, and payments to, your own Provider(s) and Payment Gateway(s).</li>
          <li>The services, pricing, descriptions, branding, and content you publish on your Panel.</li>
          <li>Your Customers, including their support, disputes, refunds, and communications.</li>
          <li>Complying with all laws and with the terms of the social-media platforms and third parties your services interact with.</li>
          <li>Collecting and remitting any taxes applicable to your sales, and your own bookkeeping.</li>
          <li>Providing your Customers with your own terms and privacy policy governing their use of your Panel.</li>
        </ul>
        <p className="fp-text-dim text-sm leading-relaxed mb-4">
          You act as an independent operator. Innvil is not a party to the transaction between you, your
          Provider, your Payment Gateway, or your Customers.
        </p>

        <h2 className="fp-display text-xl mt-10 mb-3">5. Acceptable use</h2>
        <p className="fp-text-dim text-sm leading-relaxed mb-4">You agree not to use the Platform to:</p>
        <ul className="list-disc pl-5 space-y-1.5 fp-text-dim text-sm mb-4">
          <li>Violate any applicable law or regulation, or facilitate any illegal activity.</li>
          <li>Engage in fraud, money laundering, deceptive practices, or sale of stolen goods or data.</li>
          <li>Distribute malware, engage in hacking, credential theft, phishing, or account takeover.</li>
          <li>Sell services that violate applicable law, or misrepresent services to your Customers.</li>
          <li>Infringe intellectual-property, privacy, or publicity rights of others.</li>
          <li>Interfere with, overload, or attempt to gain unauthorized access to the Platform.</li>
        </ul>
        <p className="fp-text-dim text-sm leading-relaxed mb-4">
          You acknowledge that SMM services may be restricted by the terms of certain social-media
          platforms. You are responsible for ensuring your and your Customers&apos; use complies with
          applicable law and third-party terms. Innvil may suspend or remove Panels that we reasonably
          believe violate this section.
        </p>

        <h2 className="fp-display text-xl mt-10 mb-3">6. Fees and payments</h2>
        <ul className="list-disc pl-5 space-y-1.5 fp-text-dim text-sm mb-4">
          <li>Innvil charges a commission of <strong>5% of the value of completed orders</strong>. There is no monthly rent and no setup fee unless stated otherwise.</li>
          <li>Customer deposits and wallet balances are held and reconciled through your connected Payment Gateway and the Platform ledger. Innvil does not custody customer funds and is not a bank, money transmitter, or payment processor.</li>
          <li>Cryptocurrency deposits are irreversible once confirmed on-chain. Refunds, chargebacks, and disputes are handled by you and your Payment Gateway, subject to their rules.</li>
          <li>Commission is non-refundable except where required by law. You are responsible for all taxes on your sales.</li>
          <li>We may change fees prospectively with reasonable notice.</li>
        </ul>

        <h2 className="fp-display text-xl mt-10 mb-3">7. Third-party services</h2>
        <p className="fp-text-dim text-sm leading-relaxed mb-4">
          The Platform integrates with third parties you choose (Providers and Payment Gateways) and
          third parties we use to operate (including hosting and infrastructure providers). Your use of
          those services is governed by their own terms. Innvil is not responsible for third-party acts,
          omissions, outages, fees, or data practices.
        </p>

        <h2 className="fp-display text-xl mt-10 mb-3">8. Intellectual property</h2>
        <p className="fp-text-dim text-sm leading-relaxed mb-4">
          Innvil and its licensors own the Platform, including its software, design, and trademarks. We
          grant you a limited, non-exclusive, non-transferable, revocable license to use the Platform
          per these Terms. You retain ownership of your own content and branding, and grant us the
          license needed to host and display it in order to operate your Panel.
        </p>

        <h2 className="fp-display text-xl mt-10 mb-3">9. Disclaimers</h2>
        <p className="fp-text-dim text-sm leading-relaxed mb-4">
          THE PLATFORM IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE,&quot; WITHOUT WARRANTIES OF
          ANY KIND, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND
          NON-INFRINGEMENT. We do not warrant that the Platform will be uninterrupted, secure, or
          error-free, or that any SMM service ordered through a Panel will be delivered or achieve any
          result — those are the responsibility of the applicable Provider.
        </p>

        <h2 className="fp-display text-xl mt-10 mb-3">10. Limitation of liability</h2>
        <p className="fp-text-dim text-sm leading-relaxed mb-4">
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, INNVIL WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL,
          SPECIAL, CONSEQUENTIAL, OR EXEMPLARY DAMAGES, OR FOR LOST PROFITS, REVENUE, DATA, OR GOODWILL.
          OUR TOTAL AGGREGATE LIABILITY ARISING OUT OF OR RELATING TO THESE TERMS OR THE PLATFORM WILL NOT
          EXCEED THE GREATER OF (A) THE TOTAL COMMISSION FEES YOU PAID TO INNVIL IN THE THREE (3) MONTHS
          BEFORE THE EVENT GIVING RISE TO THE CLAIM, OR (B) USD $100.
        </p>

        <h2 className="fp-display text-xl mt-10 mb-3">11. Indemnification</h2>
        <p className="fp-text-dim text-sm leading-relaxed mb-4">
          You will defend, indemnify, and hold harmless Innvil and its officers, employees, and agents
          from any claims, damages, liabilities, and expenses (including reasonable legal fees) arising
          from your Panels, your services, your Customers, your use of the Platform, or your violation of
          these Terms or applicable law.
        </p>

        <h2 className="fp-display text-xl mt-10 mb-3">12. Suspension and termination</h2>
        <p className="fp-text-dim text-sm leading-relaxed mb-4">
          You may stop using the Platform at any time. We may suspend or terminate your access, or any
          Panel, immediately for violation of these Terms, legal risk, or non-payment. Sections that by
          their nature should survive termination (including fees owed, disclaimers, limitations of
          liability, and indemnification) will survive.
        </p>

        <h2 className="fp-display text-xl mt-10 mb-3">13. Changes to the Platform and Terms</h2>
        <p className="fp-text-dim text-sm leading-relaxed mb-4">
          We may modify the Platform or these Terms. Material changes will be posted here with an updated
          date, and where required, notified to you. Continued use after changes take effect constitutes
          acceptance.
        </p>

        <h2 className="fp-display text-xl mt-10 mb-3">14. Governing law and disputes</h2>
        <p className="fp-text-dim text-sm leading-relaxed mb-4">
          These Terms are governed by the laws of [JURISDICTION], without regard to conflict-of-laws
          rules. The courts of [JURISDICTION] will have exclusive jurisdiction, unless applicable law
          requires otherwise.
        </p>

        <h2 className="fp-display text-xl mt-10 mb-3">15. General</h2>
        <p className="fp-text-dim text-sm leading-relaxed mb-4">
          If any provision is unenforceable, the rest remains in effect. These Terms are the entire
          agreement between you and Innvil regarding the Platform. You may not assign them without our
          consent; we may assign them in connection with a merger, acquisition, or sale of assets. Our
          failure to enforce a provision is not a waiver. Neither party is liable for delays caused by
          events beyond its reasonable control.
        </p>

        <h2 className="fp-display text-xl mt-10 mb-3">16. Contact</h2>
        <p className="fp-text-dim text-sm leading-relaxed mb-10">
          Questions about these Terms: [COMPANY], [CONTACT_EMAIL].
        </p>

        <div className="border-t fp-line-soft pt-6 flex items-center justify-between fp-text-faint text-xs">
          <span>© 2026 Innvil</span>
          <Link href="/privacy" className="hover:fp-text">Privacy Policy →</Link>
        </div>
      </div>
    </div>
  );
}
