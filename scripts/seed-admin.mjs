// Seed a confirmed admin account from .env.local credentials.
//
//   npm run seed:admin
//
// Reads SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD / SEED_ADMIN_ROLE and creates
// (or updates) a Supabase auth user with email already confirmed, then sets the
// matching profiles.role. Uses the service-role key, so run it locally only.
//
// Idempotent: re-running updates the password + role for the same email.

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.SEED_ADMIN_EMAIL;
const password = process.env.SEED_ADMIN_PASSWORD;
const role = process.env.SEED_ADMIN_ROLE || "panel_owner";

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
if (!email || !password) {
  console.error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in .env.local.");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findUserByEmail(targetEmail) {
  // listUsers is paginated; scan pages until found (fine for a dev seed).
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find(
      (u) => u.email?.toLowerCase() === targetEmail.toLowerCase()
    );
    if (match) return match;
    if (data.users.length < 200) break;
  }
  return null;
}

async function main() {
  let userId;

  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createErr) {
    // Most likely the user already exists — update instead.
    const existing = await findUserByEmail(email);
    if (!existing) throw createErr;
    userId = existing.id;
    const { error: updateErr } = await supabase.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
    });
    if (updateErr) throw updateErr;
    console.log(`Updated existing user ${email}`);
  } else {
    userId = created.user.id;
    console.log(`Created user ${email}`);
  }

  // Set the role (the auth.users trigger, if installed, seeds panel_owner first).
  const { error: profileErr } = await supabase
    .from("profiles")
    .upsert({ id: userId, role, display_name: email }, { onConflict: "id" });
  if (profileErr) throw profileErr;

  console.log(`Profile role set to "${role}". You can now log in with ${email}.`);
}

main().catch((err) => {
  console.error("Seed failed:", err.message || err);
  process.exit(1);
});
