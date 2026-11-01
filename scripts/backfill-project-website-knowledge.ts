import { createAdminClient } from "@/src/lib/supabase/admin";
import { syncProfileUrlKnowledge } from "@/src/lib/actions/watch-project-profile";

/**
 * One-off backfill: v1.47.63 wired Website/Documentation into real
 * ingestion, but `syncProfileUrlKnowledge` only ever runs on a NEW
 * profile save -- any project that already had a Website/Documentation
 * URL saved BEFORE that fix shipped has zero knowledge_sources rows for
 * it until an owner happens to re-save the field, which isn't a
 * reasonable thing to expect (the field already visibly shows the saved
 * value, so there's no obvious reason to click Save again). This backfill
 * runs the exact same ingestion for every existing project that has a
 * non-empty website/docs_url right now, once.
 *
 * Usage: npm run backfill:project-website-knowledge
 */
async function main() {
  const admin = createAdminClient();
  const { data: projects, error } = await admin
    .from("projects")
    .select("id, name, website, docs_url");
  if (error) {
    console.error("Failed to load projects:", error.message);
    process.exit(1);
  }

  const candidates = (projects ?? []).filter((p) => (p.website && p.website.trim()) || (p.docs_url && p.docs_url.trim()));
  console.log(`Found ${candidates.length} project(s) with a Website/Documentation URL set.`);

  let ok = 0;
  let failed = 0;
  for (const p of candidates) {
    if (p.website && p.website.trim()) {
      const res = await syncProfileUrlKnowledge(admin, p.id, "website", p.website);
      console.log(`[${p.name}] website (${p.website}) ->`, res.status, res.error ?? "");
      if (res.status === "ready" || res.status === "unchanged") ok++;
      else if (res.status === "failed") failed++;
    }
    if (p.docs_url && p.docs_url.trim()) {
      const res = await syncProfileUrlKnowledge(admin, p.id, "docs_url", p.docs_url);
      console.log(`[${p.name}] docs (${p.docs_url}) ->`, res.status, res.error ?? "");
      if (res.status === "ready" || res.status === "unchanged") ok++;
      else if (res.status === "failed") failed++;
    }
  }

  console.log(`\nDone. ${ok} ready/unchanged, ${failed} failed.`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
