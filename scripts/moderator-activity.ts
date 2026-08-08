import { createAdminClient } from "@/src/lib/supabase/admin";

/** Ad-hoc read of moderator_activity_log for debugging (decision + reason_code + timing). */

function parseArg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function main() {
  const limit = Number(parseArg("limit") ?? "20");
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("moderator_activity_log")
    .select("created_at, community_id, deployment_id, event_type, decision, reason_code, model, delivery_status")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  for (const row of (data ?? []).reverse()) {
    console.log(
      `${row.created_at}  ${row.event_type.padEnd(16)} -> ${String(row.decision).padEnd(12)} ${row.reason_code ?? ""}  deployment=${row.deployment_id}`
    );
  }
}

main().catch((err) => {
  console.error("MODERATOR_ACTIVITY_FATAL", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
