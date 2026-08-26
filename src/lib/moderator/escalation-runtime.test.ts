import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveProjectEscalationTarget, createEscalation, handleEscalationGroupMessage } from "./escalation-runtime";
import type { TelegramMessage } from "./community-runtime";

/**
 * Shared Escalation Group (Phase 1) tests. Reaches real Telegram-facing
 * functions (tokenForDeployment/isAdminOrCreator are private to
 * escalation-runtime.ts and only reachable through the exported functions),
 * so PROVIDER_KEY_SECRET must be set (providerKeySecret() throws otherwise —
 * it's NOT auto-loaded from .env.local during `npm test`) and global.fetch
 * must be mocked (no live network calls) — same conventions already
 * established in media-safety-provider.test.ts / sightengine-provider.test.ts.
 */

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>) {
  const prior: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) prior[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return fn().finally(() => {
    for (const [k, v] of Object.entries(prior)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

type Row = Record<string, unknown>;

/** A tiny in-memory Supabase-shaped fake covering exactly the query surface
 *  escalation-runtime.ts uses (select/eq/is/limit/maybeSingle/single, insert,
 *  update, delete, rpc) — one generic builder rather than a single-purpose
 *  fake per table, since this feature genuinely coordinates several tables
 *  in one call (communities, moderator_deployments, telegram_bot_integrations,
 *  watch_escalations). */
function makeFakeAdmin(seed: Record<string, Row[]>, tokenByIntegrationId: Record<string, string> = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  let nextId = 0;

  function builder(table: string, mode: "select" | "update" | "delete", patch?: Row) {
    const filters: Array<(r: Row) => boolean> = [];
    let limitN: number | null = null;

    function matched(): Row[] {
      let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      if (limitN != null) rows = rows.slice(0, limitN);
      return rows;
    }

    function execute() {
      if (mode === "select") return { data: matched(), error: null };
      if (mode === "update") {
        const rows = matched();
        for (const r of rows) Object.assign(r, patch);
        return { data: rows, error: null };
      }
      const rows = matched();
      tables[table] = (tables[table] ?? []).filter((r) => !rows.includes(r));
      return { data: rows, error: null };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api: any = {
      select() { return api; },
      eq(col: string, val: unknown) { filters.push((r) => r[col] === val); return api; },
      is(col: string, val: unknown) { filters.push((r) => (r[col] ?? null) === val); return api; },
      order() { return api; },
      limit(n: number) { limitN = n; return api; },
      async maybeSingle() {
        const { data } = execute();
        return { data: (data as Row[])[0] ?? null, error: null };
      },
      async single() {
        const res = await api.maybeSingle();
        return res.data ? res : { data: null, error: { message: "row not found" } };
      },
      // Makes `await ...update(patch).eq(...).eq(...)` (no terminal method
      // called) resolve correctly, matching the real PostgREST builder shape.
      then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
        try { resolve(execute()); } catch (e) { reject?.(e); }
      },
    };
    return api;
  }

  return {
    __tables: tables,
    from(table: string) {
      if (!tables[table]) tables[table] = [];
      return {
        select() { return builder(table, "select"); },
        insert(row: Row | Row[]) {
          // Mirrors migration 0108's real column defaults -- application code
          // (createEscalation) deliberately omits `status` on insert and
          // relies on the DB's `default 'open'`, so the fake must apply the
          // same default or it would silently diverge from real behavior.
          const defaults: Row = table === "watch_escalations" ? { status: "open" } : {};
          const rows = (Array.isArray(row) ? row : [row]).map((r) => ({ id: r.id ?? `gen-${++nextId}`, ...defaults, ...r }));
          tables[table].push(...rows);
          return {
            select() {
              return { async single() { return { data: rows[0], error: null }; } };
            },
          };
        },
        update(patch: Row) { return builder(table, "update", patch); },
        delete() { return builder(table, "delete"); },
      };
    },
    async rpc(name: string, args: Record<string, unknown>) {
      if (name === "get_telegram_bot_key") {
        const token = tokenByIntegrationId[args.p_row as string] ?? null;
        return { data: token, error: null };
      }
      throw new Error(`unexpected rpc in fake admin: ${name}`);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as SupabaseClient & { __tables: Record<string, Row[]> };
}

/** Routes global.fetch by the Telegram method name in the request URL --
 *  mirrors telegramApiCall's own URL shape (.../bot<token>/<method>), never
 *  hitting the real network. */
function fakeTelegramFetch(byMethod: Record<string, { status?: number; body: unknown }>) {
  const calls: Array<{ method: string; url: string }> = [];
  const fn = async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = url.split("/").pop() ?? "";
    calls.push({ method, url });
    const entry = byMethod[method];
    if (!entry) return new Response(JSON.stringify({ ok: false, description: `no fake response for ${method}` }), { status: 404 });
    return new Response(JSON.stringify(entry.body), { status: entry.status ?? 200 });
  };
  return { fn, calls };
}

function baseMessage(over: Partial<TelegramMessage> = {}): TelegramMessage {
  return {
    message_id: 1,
    chat: { id: -1001, type: "supergroup" },
    from: { id: 555, is_bot: false, first_name: "Admin" },
    text: "The launch is confirmed for March 1st.",
    ...over,
  };
}

/* ---------------------------------------------- resolveProjectEscalationTarget ---- */

test("REQUIRED: no escalation-group community configured for the project -> resolves null, the caller's own required fallback", async () => {
  const admin = makeFakeAdmin({ communities: [] });
  const target = await resolveProjectEscalationTarget(admin, "project-1");
  assert.equal(target, null);
});

test("REQUIRED: an escalation-group community exists but has no enabled deployment yet -> still resolves null (never a half-usable target)", async () => {
  const admin = makeFakeAdmin({
    communities: [{ id: "esc-community-1", project_id: "project-1", chat_id: "-2002", connection_type: "escalation_group" }],
    moderator_deployments: [],
  });
  const target = await resolveProjectEscalationTarget(admin, "project-1");
  assert.equal(target, null);
});

test("a real, deployable escalation-group community resolves a usable target", async () => {
  const admin = makeFakeAdmin({
    communities: [{ id: "esc-community-1", project_id: "project-1", chat_id: "-2002", connection_type: "escalation_group" }],
    moderator_deployments: [{ id: "dep-esc-1", community_id: "esc-community-1", moderator_id: "mod-1", enabled: true }],
  });
  const target = await resolveProjectEscalationTarget(admin, "project-1");
  assert.deepEqual(target, { escalationCommunityId: "esc-community-1", chatId: "-2002", deploymentId: "dep-esc-1" });
});

test("a DIFFERENT project's escalation group is never resolved -- project isolation", async () => {
  const admin = makeFakeAdmin({
    communities: [{ id: "esc-community-1", project_id: "project-OTHER", chat_id: "-2002", connection_type: "escalation_group" }],
    moderator_deployments: [{ id: "dep-esc-1", community_id: "esc-community-1", moderator_id: "mod-1", enabled: true }],
  });
  const target = await resolveProjectEscalationTarget(admin, "project-1");
  assert.equal(target, null);
});

test("an ordinary (non-escalation-group) community connected to the project is never mistaken for one", async () => {
  const admin = makeFakeAdmin({
    communities: [{ id: "ordinary-1", project_id: "project-1", chat_id: "-3003", connection_type: "community" }],
  });
  const target = await resolveProjectEscalationTarget(admin, "project-1");
  assert.equal(target, null);
});

/* ---------------------------------------------------------------- createEscalation ---- */

test("REQUIRED: with no escalation group configured, createEscalation reports ok:false -- the caller MUST fall back to the plain 'no information' behavior, never silently drop the question", async () => {
  const admin = makeFakeAdmin({ communities: [], watch_escalations: [] });
  const result = await createEscalation({
    admin, projectId: "project-1", sourceCommunityId: "source-1",
    escalatingModeratorId: "mod-1", watcherName: "Kwan",
    askerPlatformUserId: "user-1", askerDisplayName: "Alex",
    sourceMessageId: "msg-1", questionText: "When does the presale start?",
  });
  assert.equal(result.ok, false);
  assert.equal(result.forwardedText, "");
  assert.equal((admin.__tables.watch_escalations ?? []).length, 0, "no phantom escalation row should be created without a real target");
});

test("REQUIRED: a real, configured escalation group creates a tracked escalation, posts the card, and returns the user-facing forwarded text", async () => {
  const { fn, calls } = fakeTelegramFetch({
    sendMessage: { body: { ok: true, result: { message_id: 999 } } },
  });
  const originalFetch = global.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  global.fetch = fn as any;
  try {
    await withEnv({ PROVIDER_KEY_SECRET: "test-secret" }, async () => {
      const admin = makeFakeAdmin(
        {
          communities: [
            { id: "esc-community-1", project_id: "project-1", chat_id: "-2002", connection_type: "escalation_group" },
            { id: "source-1", project_id: "project-1", chat_id: "-3003", title: "Alpha Community", connection_type: "community" },
          ],
          moderator_deployments: [{ id: "dep-esc-1", community_id: "esc-community-1", moderator_id: "mod-1", enabled: true }],
          telegram_bot_integrations: [{ id: "integration-esc-1", virtual_moderator_id: "mod-1" }],
          watch_escalations: [],
        },
        { "integration-esc-1": "bot-token-abc" }
      );
      const result = await createEscalation({
        admin, projectId: "project-1", sourceCommunityId: "source-1",
        escalatingModeratorId: "mod-1", watcherName: "Kwan",
        askerPlatformUserId: "user-1", askerDisplayName: "Alex",
        sourceMessageId: "msg-1", questionText: "When does the presale start?",
      });
      assert.equal(result.ok, true);
      assert.match(result.forwardedText, /forwarded this question to the team/i);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].method, "sendMessage");
      const rows = admin.__tables.watch_escalations as Row[];
      assert.equal(rows.length, 1);
      assert.equal(rows[0].status, "open");
      assert.equal(rows[0].escalation_message_id, "999");
      assert.equal(rows[0].question_text, "When does the presale start?");
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("a failed Telegram send is not left as a phantom escalation row -- the just-inserted row is rolled back", async () => {
  const { fn } = fakeTelegramFetch({ sendMessage: { body: { ok: false, description: "bot lacks permission" } } });
  const originalFetch = global.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  global.fetch = fn as any;
  try {
    await withEnv({ PROVIDER_KEY_SECRET: "test-secret" }, async () => {
      const admin = makeFakeAdmin(
        {
          communities: [
            { id: "esc-community-1", project_id: "project-1", chat_id: "-2002", connection_type: "escalation_group" },
            { id: "source-1", project_id: "project-1", chat_id: "-3003", title: "Alpha Community", connection_type: "community" },
          ],
          moderator_deployments: [{ id: "dep-esc-1", community_id: "esc-community-1", moderator_id: "mod-1", enabled: true }],
          telegram_bot_integrations: [{ id: "integration-esc-1", virtual_moderator_id: "mod-1" }],
          watch_escalations: [],
        },
        { "integration-esc-1": "bot-token-abc" }
      );
      const result = await createEscalation({
        admin, projectId: "project-1", sourceCommunityId: "source-1",
        escalatingModeratorId: "mod-1", watcherName: "Kwan",
        askerPlatformUserId: "user-1", askerDisplayName: "Alex",
        sourceMessageId: "msg-1", questionText: "When does the presale start?",
      });
      assert.equal(result.ok, false);
      assert.equal((admin.__tables.watch_escalations ?? []).length, 0);
    });
  } finally {
    global.fetch = originalFetch;
  }
});

/* ---------------------------------------------------------- handleEscalationGroupMessage ---- */

const OPEN_ESCALATION: Row = {
  id: "esc-1", project_id: "project-1", escalation_community_id: "esc-community-1",
  source_community_id: "source-1", watcher_id: "mod-1",
  asker_platform_user_id: "user-1", asker_display_name: "Alex",
  source_message_id: "src-msg-1", question_text: "When does the presale start?",
  escalation_message_id: "999", status: "open",
};

function seedForGroupMessage(escalationRows: Row[]) {
  return {
    communities: [{ id: "esc-community-1", project_id: "project-1", chat_id: "-2002", connection_type: "escalation_group" }, { id: "source-1", project_id: "project-1", chat_id: "-3003", connection_type: "community" }],
    moderator_deployments: [
      { id: "dep-esc-1", community_id: "esc-community-1", moderator_id: "mod-1", enabled: true },
      { id: "dep-source-1", community_id: "source-1", moderator_id: "mod-1", enabled: true },
    ],
    telegram_bot_integrations: [{ id: "integration-esc-1", virtual_moderator_id: "mod-1" }],
    watch_escalations: escalationRows,
  };
}

test("REQUIRED: a non-reply message in the escalation group is a silent no-op -- nothing to resolve", async () => {
  const originalFetch = global.fetch;
  let fetchCalled = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  global.fetch = (async () => { fetchCalled = true; throw new Error("should not call Telegram"); }) as any;
  try {
    const admin = makeFakeAdmin(seedForGroupMessage([{ ...OPEN_ESCALATION }]), { "integration-esc-1": "bot-token-abc" });
    await handleEscalationGroupMessage(admin, { id: "esc-community-1", chatId: "-2002" }, baseMessage({ reply_to_message: undefined }));
    const row = (admin.__tables.watch_escalations as Row[])[0];
    assert.equal(row.status, "open");
    assert.equal(fetchCalled, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("REQUIRED: a reply to a message that isn't any tracked escalation's card is a silent no-op", async () => {
  const originalFetch = global.fetch;
  let fetchCalled = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  global.fetch = (async () => { fetchCalled = true; throw new Error("should not call Telegram"); }) as any;
  try {
    const admin = makeFakeAdmin(seedForGroupMessage([{ ...OPEN_ESCALATION }]), { "integration-esc-1": "bot-token-abc" });
    await handleEscalationGroupMessage(
      admin,
      { id: "esc-community-1", chatId: "-2002" },
      baseMessage({ reply_to_message: { message_id: 12345 } as TelegramMessage["reply_to_message"] })
    );
    const row = (admin.__tables.watch_escalations as Row[])[0];
    assert.equal(row.status, "open");
    assert.equal(fetchCalled, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("REQUIRED: a non-admin's reply to a real escalation card is silently ignored -- must NEVER resolve/publish anything (the spec's own hard security requirement)", async () => {
  const { fn, calls } = fakeTelegramFetch({ getChatMember: { body: { ok: true, result: { status: "member" } } } });
  const originalFetch = global.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  global.fetch = fn as any;
  try {
    await withEnv({ PROVIDER_KEY_SECRET: "test-secret" }, async () => {
      const admin = makeFakeAdmin(seedForGroupMessage([{ ...OPEN_ESCALATION }]), { "integration-esc-1": "bot-token-abc" });
      await handleEscalationGroupMessage(
        admin,
        { id: "esc-community-1", chatId: "-2002" },
        baseMessage({ from: { id: 777, is_bot: false, first_name: "Regular Member" }, reply_to_message: { message_id: 999 } as TelegramMessage["reply_to_message"] })
      );
      const row = (admin.__tables.watch_escalations as Row[])[0];
      assert.equal(row.status, "open", "a non-admin reply must never mark the escalation answered");
      assert.equal(row.answer_text, undefined);
      assert.equal(calls.some((c) => c.method === "sendMessage"), false, "nothing must ever be sent back to the source community from an unauthorized reply");
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("REQUIRED: a real admin's reply resolves the escalation and relays the approved answer back to the source community", async () => {
  const { fn, calls } = fakeTelegramFetch({
    getChatMember: { body: { ok: true, result: { status: "administrator" } } },
    sendMessage: { body: { ok: true, result: { message_id: 1001 } } },
  });
  const originalFetch = global.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  global.fetch = fn as any;
  try {
    await withEnv({ PROVIDER_KEY_SECRET: "test-secret" }, async () => {
      const admin = makeFakeAdmin(seedForGroupMessage([{ ...OPEN_ESCALATION }]), { "integration-esc-1": "bot-token-abc" });
      await handleEscalationGroupMessage(
        admin,
        { id: "esc-community-1", chatId: "-2002" },
        baseMessage({ from: { id: 555, is_bot: false, first_name: "Admin" }, text: "March 1st, confirmed.", reply_to_message: { message_id: 999 } as TelegramMessage["reply_to_message"] })
      );
      const row = (admin.__tables.watch_escalations as Row[])[0];
      assert.equal(row.status, "answered");
      assert.equal(row.answer_text, "March 1st, confirmed.");
      assert.equal(row.answered_by_platform_user_id, "555");
      const sendCall = calls.find((c) => c.method === "sendMessage");
      assert.ok(sendCall, "the approved answer must be relayed back to the source community");
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("REQUIRED: a second reply to an already-ANSWERED escalation is idempotent -- never overwrites the recorded answer or sends a second relay", async () => {
  const { fn, calls } = fakeTelegramFetch({
    getChatMember: { body: { ok: true, result: { status: "administrator" } } },
    sendMessage: { body: { ok: true, result: { message_id: 1001 } } },
  });
  const originalFetch = global.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  global.fetch = fn as any;
  try {
    await withEnv({ PROVIDER_KEY_SECRET: "test-secret" }, async () => {
      const admin = makeFakeAdmin(seedForGroupMessage([{ ...OPEN_ESCALATION, status: "answered", answer_text: "March 1st, confirmed.", answered_by_platform_user_id: "555" }]), { "integration-esc-1": "bot-token-abc" });
      await handleEscalationGroupMessage(
        admin,
        { id: "esc-community-1", chatId: "-2002" },
        baseMessage({ from: { id: 555, is_bot: false, first_name: "Admin" }, text: "Actually, April 1st!", reply_to_message: { message_id: 999 } as TelegramMessage["reply_to_message"] })
      );
      const row = (admin.__tables.watch_escalations as Row[])[0];
      // The initial lookup only ever matches status='open' -- an already-
      // answered escalation is never found again, so a second reply is a
      // pure no-op: the FIRST recorded answer is preserved untouched.
      assert.equal(row.answer_text, "March 1st, confirmed.");
      assert.equal(calls.some((c) => c.method === "sendMessage"), false);
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("an empty-text reply is never treated as an approved answer", async () => {
  const { fn, calls } = fakeTelegramFetch({ getChatMember: { body: { ok: true, result: { status: "administrator" } } } });
  const originalFetch = global.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  global.fetch = fn as any;
  try {
    await withEnv({ PROVIDER_KEY_SECRET: "test-secret" }, async () => {
      const admin = makeFakeAdmin(seedForGroupMessage([{ ...OPEN_ESCALATION }]), { "integration-esc-1": "bot-token-abc" });
      await handleEscalationGroupMessage(
        admin,
        { id: "esc-community-1", chatId: "-2002" },
        baseMessage({ from: { id: 555, is_bot: false, first_name: "Admin" }, text: "", reply_to_message: { message_id: 999 } as TelegramMessage["reply_to_message"] })
      );
      const row = (admin.__tables.watch_escalations as Row[])[0];
      assert.equal(row.status, "open");
      assert.equal(calls.some((c) => c.method === "sendMessage"), false);
    });
  } finally {
    global.fetch = originalFetch;
  }
});
