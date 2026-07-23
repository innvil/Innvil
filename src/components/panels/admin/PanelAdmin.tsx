"use client";

import React, { useEffect, useState } from "react";
import {
  LayoutGrid, Circle, Palette, Globe, Wifi, Sliders, ShieldCheck,
  ListOrdered, Users, CreditCard, KeyRound, Lock, Bell, MessageSquare, Bot,
  Gift, Gauge, Copy, ExternalLink, ChevronDown, MessageCircle, LucideIcon,
} from "lucide-react";
import { StatusBadge } from "@/src/components/ui";
import { PanelStatus } from "@/src/data/constants";
import { Panel, CustomerRow } from "@/src/types";
import { updatePanelStatus } from "@/src/lib/actions/panels";
import { panelStorefrontPath } from "@/src/lib/config";
import { CustomerDrawer } from "./CustomerDrawer";
import { OwnerAssistantTab } from "./OwnerAssistant";
import {
  OverviewTab, StatusTab, BrandingTab, DomainTab, ProvidersTab, ServicesTab,
  FloorTab, OrdersTab, CustomersTab, PaymentsTab, CustomerApiTab,
  RiskTab, NotificationsTab, SupportTab, AutomationTab, PromotionsTab,
} from "./AdminTabs";

const TABS: Array<{ k: string; label: string; icon: LucideIcon }> = [
  { k: "overview", label: "Overview", icon: LayoutGrid },
  { k: "status", label: "Status", icon: Circle },
  { k: "branding", label: "Branding & Design", icon: Palette },
  { k: "domain", label: "Domain", icon: Globe },
  { k: "providers", label: "Providers & API", icon: Wifi },
  { k: "services", label: "Services & Pricing", icon: Sliders },
  { k: "floor", label: "Pricing Floor", icon: ShieldCheck },
  { k: "orders", label: "Orders", icon: ListOrdered },
  { k: "payments", label: "Payments", icon: CreditCard },
  { k: "customers", label: "Customers", icon: Users },
  { k: "api", label: "Customer API", icon: KeyRound },
  { k: "risk", label: "Risk & Security", icon: Lock },
  { k: "notifications", label: "Notifications", icon: Bell },
  { k: "support", label: "Support", icon: MessageSquare },
  { k: "assistant", label: "AI Assistant", icon: MessageCircle },
  { k: "automation", label: "Automation", icon: Bot },
  { k: "promotions", label: "Promotions", icon: Gift },
];

// First 10 tabs stay on the bar; the rest go in the "More" menu.
const PRIMARY_TABS = TABS.slice(0, 10);
const OVERFLOW_TABS = TABS.slice(10);

export function PanelAdmin({ panel, setWorld, initialTab, onTabChange }: { panel: Panel; setWorld: (w: string) => void; initialTab?: string; onTabChange?: (tab: string) => void }) {
  const readSavedTab = (panelId: string): string | null => {
    if (typeof window === "undefined") return null;
    const key = `innvil-admin:${panelId}:active-tab`;
    try {
      return window.sessionStorage.getItem(key) ?? window.localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const [tab, setTab] = useState(() => initialTab || readSavedTab(panel.id) || "overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [panelStatus, setPanelStatus] = useState<PanelStatus>(panel.status || "live");

  // Persist status changes (optimistic; roll back on failure).
  const changeStatus = async (next: PanelStatus) => {
    const prev = panelStatus;
    setPanelStatus(next);
    const res = await updatePanelStatus(panel.id, next);
    if (!res.ok) { setPanelStatus(prev); return; }
    setPanelStatus(res.status); // server may downgrade Live → Inactive (preview) when unfunded
  };
  const overflowActive = OVERFLOW_TABS.some((t) => t.k === tab);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null);
  const [focusCustomerId, setFocusCustomerId] = useState<string | null>(null);

  useEffect(() => {
    setTab(initialTab || readSavedTab(panel.id) || "overview");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel.id, initialTab]);

  useEffect(() => {
    const key = `innvil-admin:${panel.id}:active-tab`;
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(key, tab);
      window.localStorage.setItem(key, tab);
    } catch {
      // ignore storage failures
    }
    onTabChange?.(tab);
  }, [panel.id, tab]);

  return (
    <div>
      <div className="px-4 sm:px-8 pt-6 pb-4 border-b fp-line-soft flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl fp-gold-soft-bg flex items-center justify-center">
            <Gauge size={18} className="fp-gold" />
          </div>
          <div>
            <p className="fp-display text-xl">{panel.name}</p>
            <p className="fp-text-faint text-xs fp-mono flex items-center gap-1">
              {panel.domain || panel.subdomain} <Copy size={11} className="cursor-pointer" />
            </p>
          </div>
          <StatusBadge status={panelStatus} />
        </div>
        <div className="flex items-center gap-2">
          <a
            href={panelStorefrontPath(panel.subdomain, panel.domain)}
            target="_blank"
            rel="noopener noreferrer"
            className="fp-panel-raised border fp-line-soft text-sm px-4 py-2 rounded-lg flex items-center gap-1.5 hover:fp-gold-border"
          >
            <ExternalLink size={14} /> View live panel
          </a>
        </div>
      </div>

      <div className="px-4 sm:px-8 pt-4 border-b fp-line-soft flex items-center gap-2">
        <div className="flex gap-1 overflow-x-auto flex-1 min-w-0">
          {PRIMARY_TABS.map((t) => (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              className={`flex items-center gap-1.5 text-xs px-3 py-2.5 rounded-t-lg whitespace-nowrap ${tab === t.k ? "fp-gold border-b-2 fp-gold-border" : "fp-text-dim"}`}
            >
              <t.icon size={13} /> {t.label}
            </button>
          ))}
        </div>
        <div className="relative shrink-0">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="More sections"
            className={`flex items-center gap-1.5 text-xs px-3 py-2.5 rounded-t-lg whitespace-nowrap transition-colors ${
              overflowActive || menuOpen ? "fp-gold border-b-2 fp-gold-border" : "fp-text-dim hover:fp-text"
            }`}
          >
            More
            <ChevronDown size={13} className={`transition-transform ${menuOpen ? "rotate-180" : ""}`} />
          </button>
          {menuOpen && (
            <>
              <button
                aria-hidden
                onClick={() => setMenuOpen(false)}
                className="fixed inset-0 z-40 cursor-default"
              />
              <div className="absolute right-0 top-full mt-1 w-56 fp-panel border fp-line rounded-xl shadow-2xl z-50 py-1 max-h-[70vh] overflow-y-auto">
                {OVERFLOW_TABS.map((t) => (
                  <button
                    key={t.k}
                    onClick={() => { setTab(t.k); setMenuOpen(false); }}
                    className={`w-full text-left flex items-center gap-2.5 px-4 py-2.5 text-sm ${tab === t.k ? "fp-gold-soft-bg fp-gold" : "fp-text-dim hover:fp-text"}`}
                  >
                    <t.icon size={15} /> {t.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="p-4 sm:p-8 space-y-6">
        {tab === "overview" && <OverviewTab panel={panel} />}
        {tab === "status" && <StatusTab panelId={panel.id} panelStatus={panelStatus} setPanelStatus={changeStatus} innvilBalance={panel.innvilBalance} />}
        {tab === "branding" && <BrandingTab panel={panel} />}
        {tab === "domain" && <DomainTab panel={panel} />}
        {tab === "providers" && <ProvidersTab panelId={panel.id} />}
        {tab === "services" && <ServicesTab panelId={panel.id} />}
        {tab === "floor" && <FloorTab />}
        {tab === "orders" && (
          <OrdersTab
            panelId={panel.id}
            onManageCustomer={(customerAccountId) => {
              setFocusCustomerId(customerAccountId);
              setTab("customers");
            }}
          />
        )}
        {tab === "customers" && <CustomersTab panel={panel} onView={setSelectedCustomer} focusCustomerId={focusCustomerId} />}
        {tab === "payments" && <PaymentsTab panelId={panel.id} />}
        {tab === "api" && <CustomerApiTab panelId={panel.id} />}
        {tab === "risk" && <RiskTab />}
        {tab === "notifications" && <NotificationsTab />}
        {tab === "support" && <SupportTab panelId={panel.id} />}
        {tab === "assistant" && <OwnerAssistantTab panelId={panel.id} panelName={panel.name} />}
        {tab === "automation" && <AutomationTab />}
        {tab === "promotions" && <PromotionsTab />}
      </div>

      <CustomerDrawer customer={selectedCustomer} onClose={() => setSelectedCustomer(null)} />
    </div>
  );
}
