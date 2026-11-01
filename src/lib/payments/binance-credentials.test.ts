import assert from "node:assert/strict";
import test from "node:test";

import { loadActiveBinanceCredentials } from "./binance-credentials";
import { paymentBelongsToRequestScope } from "./binance-scope";

test("panel A verification loads only panel A credentials", async () => {
  let capturedPanelId: string | null = null;
  let capturedRowId: string | null = null;

  const out = await loadActiveBinanceCredentials("panelA", {
    getActiveGatewayRow: async (panelId) => {
      capturedPanelId = panelId;
      return { id: "rowA", config: { payId: "a" } };
    },
    decryptGatewaySecrets: async (rowId) => {
      capturedRowId = rowId;
      return { data: JSON.stringify({ apiKey: "keyA", apiSecret: "secretA" }), error: null };
    },
    logError: () => {},
  });

  assert.equal(capturedPanelId, "panelA");
  assert.equal(capturedRowId, "rowA");
  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.secrets.apiKey, "keyA");
    assert.equal(out.secrets.apiSecret, "secretA");
  }
});

test("panel A cannot decrypt or use panel B credentials", async () => {
  const out = await loadActiveBinanceCredentials("panelA", {
    getActiveGatewayRow: async (panelId) => {
      if (panelId === "panelA") return { id: "rowA", config: { payId: "a" } };
      if (panelId === "panelB") return { id: "rowB", config: { payId: "b" } };
      return null;
    },
    decryptGatewaySecrets: async (rowId) => {
      if (rowId === "rowA") {
        return { data: JSON.stringify({ apiKey: "keyA", apiSecret: "secretA" }), error: null };
      }
      if (rowId === "rowB") {
        return { data: JSON.stringify({ apiKey: "keyB", apiSecret: "secretB" }), error: null };
      }
      return { data: null, error: new Error("unexpected row") };
    },
    logError: () => {},
  });

  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.rowId, "rowA");
    assert.equal(out.secrets.apiKey, "keyA");
    assert.notEqual(out.secrets.apiKey, "keyB");
  }
});

test("payment belonging to panel A cannot be verified with panel B request scope", () => {
  const inScope = paymentBelongsToRequestScope(
    { customer_id: "custA", panel_id: "panelA", gateway: "binance_pay" },
    "panelA",
    "custA"
  );
  const crossPanel = paymentBelongsToRequestScope(
    { customer_id: "custA", panel_id: "panelA", gateway: "binance_pay" },
    "panelB",
    "custA"
  );

  assert.equal(inScope, true);
  assert.equal(crossPanel, false);
});

test("missing or inactive credentials return BINANCE_NOT_CONFIGURED", async () => {
  const missing = await loadActiveBinanceCredentials("panelA", {
    getActiveGatewayRow: async () => null,
    decryptGatewaySecrets: async () => ({ data: null, error: null }),
    logError: () => {},
  });

  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.code, "BINANCE_NOT_CONFIGURED");
  }
});

test("decryption failure returns BINANCE_NOT_CONFIGURED", async () => {
  const out = await loadActiveBinanceCredentials("panelA", {
    getActiveGatewayRow: async () => ({ id: "rowA", config: {} }),
    decryptGatewaySecrets: async () => ({ data: null, error: { code: "P0001" } }),
    logError: () => {},
  });

  assert.equal(out.ok, false);
  if (!out.ok) {
    assert.equal(out.code, "BINANCE_NOT_CONFIGURED");
    assert.equal(out.reason, "BINANCE_DECRYPT_FAILED");
  }
});

test("no BINANCE_PUBLIC/BINANCE_SECRET fallback is used", async () => {
  process.env.BINANCE_PUBLIC = "global_public_should_not_be_used";
  process.env.BINANCE_SECRET = "global_secret_should_not_be_used";

  const out = await loadActiveBinanceCredentials("panelA", {
    getActiveGatewayRow: async () => null,
    decryptGatewaySecrets: async () => ({ data: null, error: null }),
    logError: () => {},
  });

  assert.equal(out.ok, false);
  if (!out.ok) {
    assert.equal(out.code, "BINANCE_NOT_CONFIGURED");
  }
});
