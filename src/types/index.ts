/* =========================================================
   SHARED TYPES
   ========================================================= */

import { PanelStatus } from "@/src/data/constants";

export type { PanelStatus };

// Database row types mirroring the Supabase schema (Phase 3+).
export * from "./db";

/** A white-label SMM panel created by a panel owner. */
export interface Panel {
  id: string;
  name: string;
  subdomain: string;
  domain: string | null;
  status: PanelStatus;
  ordersToday: number;
  theme: string;
}

/** A customer row as shown in the panel owner's Customers tab. */
export interface CustomerRow {
  handle: string;
  panel: string;
  orders: number;
  spent: string;
  joined: string;
}
