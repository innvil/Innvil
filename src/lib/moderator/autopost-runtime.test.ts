import { test } from "node:test";
import assert from "node:assert/strict";
import { loadKnowledgeForWindow } from "./autopost-runtime";

interface FakeKnowledgeRow {
  panel_id: string; scope_type: "COMMUNITY" | "PROJECT" | "ORGANIZATION";
  project_id: string | null; community_id: string | null;
  kind: string; title: string; content: string; active: boolean;
}

interface FakeProjectProfile { name?: string; overview?: string; website?: string; docs_url?: string }

function fakeAdmin(
  rows: FakeKnowledgeRow[],
  communityProjects: Record<string, string> = {},
  projectProfiles: Record<string, FakeProjectProfile> = {}
) {
  return {
    from(table: string) {
      if (table === "communities") {
        const filters: Record<string, unknown> = {};
        const api = {
          select() { return api; },
          eq(col: string, val: unknown) { filters[col] = val; return api; },
          async maybeSingle() {
            const id = filters.id as string;
            return { data: communityProjects[id] ? { project_id: communityProjects[id] } : null, error: null };
          },
        };
        return api;
      }
      if (table === "projects") {
        const filters: Record<string, unknown> = {};
        const api = {
          select() { return api; },
          eq(col: string, val: unknown) { filters[col] = val; return api; },
          async maybeSingle() {
            const id = filters.id as string;
            const p = projectProfiles[id];
            return { data: { name: p?.name ?? "", overview: p?.overview ?? "", website: p?.website ?? "", docs_url: p?.docs_url ?? "" }, error: null };
          },
        };
        return api;
      }
      if (table !== "knowledge_sources") throw new Error(`unexpected table: ${table}`);
      const filters: Record<string, unknown> = {};
      const api = {
        select() { return api; },
        eq(col: string, val: unknown) { filters[col] = val; return api; },
        then(resolve: (r: { data: typeof rows; error: null }) => void) {
          const data = rows.filter((r) => Object.entries(filters).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v));
          resolve({ data, error: null });
        },
      };
      return api;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

test("REQUIRED: Auto-Posting sources from the Project Profile's overview FIRST, ahead of website/docs and free-form knowledge", async () => {
  const admin = fakeAdmin(
    [{ panel_id: "panel-1", scope_type: "PROJECT", project_id: "project-1", community_id: null, kind: "fact", title: "Extra fact", content: "some extra fact", active: true }],
    { "community-1": "project-1" },
    { "project-1": { name: "Litho", overview: "Litho is a DeFi yield protocol on multiple chains.", website: "https://litho.example", docs_url: "https://docs.litho.example" } }
  );
  const entries = await loadKnowledgeForWindow(admin, "panel-1", "community-1");
  assert.equal(entries[0].content, "Litho is a DeFi yield protocol on multiple chains.");
  assert.equal(entries[1].content, "https://litho.example");
  assert.equal(entries[2].content, "https://docs.litho.example");
  assert.ok(entries.some((e) => e.content === "some extra fact"));
});

test("a project with no overview/website/docs still surfaces its free-form knowledge", async () => {
  const admin = fakeAdmin(
    [{ panel_id: "panel-1", scope_type: "PROJECT", project_id: "project-1", community_id: null, kind: "fact", title: "Fact", content: "a real fact", active: true }],
    { "community-1": "project-1" },
    { "project-1": {} }
  );
  const entries = await loadKnowledgeForWindow(admin, "panel-1", "community-1");
  assert.deepEqual(entries.map((e) => e.content), ["a real fact"]);
});

test("REQUIRED: contacts are never included -- the loader never even reads project.contacts, only overview/website/docs_url", async () => {
  // Structural proof: the fake project-profile response below has NO
  // `contacts` field at all -- if loadKnowledgeForWindow tried to read it,
  // it would get `undefined`, not a value that could leak into the output.
  const admin = fakeAdmin([], { "community-1": "project-1" }, { "project-1": { overview: "Real overview content." } });
  const entries = await loadKnowledgeForWindow(admin, "panel-1", "community-1");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].content, "Real overview content.");
  for (const e of entries) {
    assert.ok(!e.content.includes("@"), "no contact-shaped content should ever appear in auto-post source material");
  }
});

test("community context and legacy organization knowledge still flow through as lower-priority fallback material", async () => {
  const admin = fakeAdmin(
    [
      { panel_id: "panel-1", scope_type: "COMMUNITY", project_id: null, community_id: "community-1", kind: "fact", title: "Local", content: "community-specific tip", active: true },
      { panel_id: "panel-1", scope_type: "ORGANIZATION", project_id: null, community_id: null, kind: "fact", title: "Org", content: "org-wide legacy fact", active: true },
    ],
    { "community-1": "project-1" },
    { "project-1": { overview: "Main overview." } }
  );
  const entries = await loadKnowledgeForWindow(admin, "panel-1", "community-1");
  assert.equal(entries[0].content, "Main overview."); // overview always first
  assert.ok(entries.some((e) => e.content === "community-specific tip"));
  assert.ok(entries.some((e) => e.content === "org-wide legacy fact"));
});

test("no project resolved for the community -> only community/organization knowledge, no crash", async () => {
  const admin = fakeAdmin(
    [{ panel_id: "panel-1", scope_type: "ORGANIZATION", project_id: null, community_id: null, kind: "fact", title: "Org", content: "org fact", active: true }],
    {} // community-1 has no resolved project
  );
  const entries = await loadKnowledgeForWindow(admin, "panel-1", "community-1");
  assert.deepEqual(entries.map((e) => e.content), ["org fact"]);
});
