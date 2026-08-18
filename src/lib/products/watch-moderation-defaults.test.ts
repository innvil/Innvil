import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getModerationDefaults, applyModerationDefaultPreset, clearModerationDefaultPreset,
  setModerationDefaultDescription, setModerationDefaultCustomInstructions, resetModerationDefaults,
} from "./watch-moderation-defaults";
import { DEFAULT_MODERATOR_PERSONA } from "@/src/lib/moderator/domain";

type Row = Record<string, unknown>;

function fakeAdmin(seed: { watch_moderation_defaults?: Row[] }) {
  const store: Record<string, Row[]> = { watch_moderation_defaults: seed.watch_moderation_defaults ?? [] };
  return {
    __store: store,
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const rowsMatching = () => (store[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
      return {
        select() { return this; },
        eq(col: string, val: unknown) { filters.push([col, val]); return this; },
        async maybeSingle() { return { data: rowsMatching()[0] ?? null, error: null }; },
        upsert(row: Row, opts: { onConflict: string }) {
          const keys = opts.onConflict.split(",");
          const idx = (store[table] ?? []).findIndex((r) => keys.every((k) => r[k] === row[k]));
          if (idx >= 0) { store[table][idx] = { ...store[table][idx], ...row }; return Promise.resolve({ data: null, error: null }); }
          store[table] = [...(store[table] ?? []), { ...row }];
          return Promise.resolve({ data: null, error: null });
        },
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

test("REQUIRED: getModerationDefaults falls back to the platform default when nothing is configured -- never fabricated", async () => {
  const admin = fakeAdmin({});
  const persona = await getModerationDefaults(admin, "acct-1");
  assert.deepEqual(persona, DEFAULT_MODERATOR_PERSONA);
});

test("REQUIRED: applying a preset persists it and getModerationDefaults reflects it afterward", async () => {
  const admin = fakeAdmin({});
  const result = await applyModerationDefaultPreset(admin, "acct-1", "witty_mod");
  assert.equal(result.ok, true);
  const persona = await getModerationDefaults(admin, "acct-1");
  assert.equal(persona.presetId, "witty_mod");
});

test("applyModerationDefaultPreset rejects an unknown preset id -- never silently no-ops as success", async () => {
  const admin = fakeAdmin({});
  const result = await applyModerationDefaultPreset(admin, "acct-1", "not-a-real-preset");
  assert.equal(result.ok, false);
});

test("clearModerationDefaultPreset removes the preset link but preserves the rest of the persona", async () => {
  const admin = fakeAdmin({});
  await applyModerationDefaultPreset(admin, "acct-1", "witty_mod");
  const before = await getModerationDefaults(admin, "acct-1");
  await clearModerationDefaultPreset(admin, "acct-1");
  const after = await getModerationDefaults(admin, "acct-1");
  assert.equal(after.presetId, null);
  assert.equal(after.customInstructions, before.customInstructions);
});

test("setModerationDefaultDescription saves and trims/truncates like the per-Watcher equivalent", async () => {
  const admin = fakeAdmin({});
  await setModerationDefaultDescription(admin, "acct-1", "  Friendly and concise.  ");
  const persona = await getModerationDefaults(admin, "acct-1");
  assert.equal(persona.description, "Friendly and concise.");
});

test("setModerationDefaultCustomInstructions saves without clobbering the description already set", async () => {
  const admin = fakeAdmin({});
  await setModerationDefaultDescription(admin, "acct-1", "Friendly");
  await setModerationDefaultCustomInstructions(admin, "acct-1", "Never discuss competitors.");
  const persona = await getModerationDefaults(admin, "acct-1");
  assert.equal(persona.description, "Friendly");
  assert.equal(persona.customInstructions, "Never discuss competitors.");
});

test("REQUIRED: moderation defaults never leak across accounts", async () => {
  const admin = fakeAdmin({});
  await applyModerationDefaultPreset(admin, "acct-1", "witty_mod");
  const other = await getModerationDefaults(admin, "acct-2");
  assert.equal(other.presetId, null);
});

test("REQUIRED: resetModerationDefaults restores the exact real canonical platform default, not a fabricated shape", async () => {
  const admin = fakeAdmin({});
  await applyModerationDefaultPreset(admin, "acct-1", "witty_mod");
  await setModerationDefaultDescription(admin, "acct-1", "Something custom");
  await setModerationDefaultCustomInstructions(admin, "acct-1", "Extra notes");

  const result = await resetModerationDefaults(admin, "acct-1");
  assert.equal(result.ok, true);
  const persona = await getModerationDefaults(admin, "acct-1");
  assert.deepEqual(persona, DEFAULT_MODERATOR_PERSONA);
});

test("resetModerationDefaults only affects the calling account", async () => {
  const admin = fakeAdmin({});
  await applyModerationDefaultPreset(admin, "acct-1", "witty_mod");
  await applyModerationDefaultPreset(admin, "acct-2", "calm_professional");
  await resetModerationDefaults(admin, "acct-1");
  const other = await getModerationDefaults(admin, "acct-2");
  assert.equal(other.presetId, "calm_professional");
});
