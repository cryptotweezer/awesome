// List and remove trial businesses.
//
//   node --env-file=.env.local scripts/demo-orgs.mjs              # list them
//   node --env-file=.env.local scripts/demo-orgs.mjs --delete <id>
//   node --env-file=.env.local scripts/demo-orgs.mjs --delete-all
//
// Why this exists: local development points at the production database, so a
// business created while trying the guest flow is a real row. Until the
// multi-tenant code is deployed, the live dashboard still runs the old queries
// that do not filter by organisation, which means a leftover test business
// shows up in the real one. This is how you sweep it up afterwards.
//
// It can only ever touch trial businesses. The business that owns the
// deployment has is_demo = false and is invisible to every query here.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Run with: node --env-file=.env.local scripts/demo-orgs.mjs");
  process.exit(1);
}

const db = createClient(url, key, {
  db: { schema: "awesome" },
  auth: { persistSession: false, autoRefreshToken: false },
});

async function list() {
  const { data, error } = await db
    .from("orgs")
    .select("id, name, created_at, last_active_at")
    .eq("is_demo", true)
    .order("created_at");
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  return data ?? [];
}

// Explicit order rather than relying on cascades: invoices reference clients
// and issuers with no cascade of their own, so the order a cascade happens to
// pick could fail.
async function remove(org) {
  for (const [table, column] of [
    ["invoice_items", "org_id"],
    ["invoices", "org_id"],
    ["clients", "org_id"],
    ["issuers", "org_id"],
    ["agent_keys", "org_id"],
    ["org_members", "org_id"],
  ]) {
    const { error } = await db.from(table).delete().eq(column, org.id);
    if (error) {
      console.error(`${table}: ${error.message}`);
      process.exit(1);
    }
  }
  // The guard is here as well as in the query above: this is the statement
  // that would be unrecoverable if the id were ever wrong.
  const { error } = await db
    .from("orgs")
    .delete()
    .eq("id", org.id)
    .eq("is_demo", true);
  if (error) {
    console.error(`orgs: ${error.message}`);
    process.exit(1);
  }
  await db.storage
    .from("org-logos")
    .remove([`${org.id}/logo.png`, `${org.id}/logo.jpg`])
    .catch(() => undefined);
  console.log(`Removed ${org.name} (${org.id})`);
}

const orgs = await list();
const args = process.argv.slice(2);

if (args.includes("--delete-all")) {
  if (orgs.length === 0) {
    console.log("No trial businesses to remove.");
  }
  for (const org of orgs) await remove(org);
  process.exit(0);
}

const deleteAt = args.indexOf("--delete");
if (deleteAt !== -1) {
  const id = args[deleteAt + 1];
  const org = orgs.find((o) => o.id === id);
  if (!org) {
    console.error(`No trial business with id ${id}. Run without arguments to list them.`);
    process.exit(1);
  }
  await remove(org);
  process.exit(0);
}

if (orgs.length === 0) {
  console.log("No trial businesses. Only the business that owns this deployment exists.");
} else {
  console.log(`${orgs.length} trial business(es):\n`);
  for (const org of orgs) {
    const counts = await Promise.all(
      ["clients", "invoices", "agent_keys"].map(async (t) => {
        const { count } = await db
          .from(t)
          .select("*", { count: "exact", head: true })
          .eq("org_id", org.id);
        return `${count ?? 0} ${t}`;
      }),
    );
    console.log(`  ${org.id}  ${org.name}`);
    console.log(`    created ${org.created_at.slice(0, 10)}, ${counts.join(", ")}`);
  }
  console.log("\nRemove one with --delete <id>, or all of them with --delete-all.");
}
