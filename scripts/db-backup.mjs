// Full snapshot of the `awesome` schema straight to a JSON file on disk.
//
//   node --env-file=.env.local scripts/db-backup.mjs [outDir]
//
// Runnable without a browser session, which is what a migration needs, and
// wider than the dashboard button: every table of the schema rather than one
// organisation's. `agent_keys` rows are included WITHOUT their hashes so the
// file is a safety net and not a set of credentials.
import { createClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  console.error("Run with: node --env-file=.env.local scripts/db-backup.mjs");
  process.exit(1);
}

const db = createClient(url, key, {
  db: { schema: "awesome" },
  auth: { persistSession: false, autoRefreshToken: false },
});

// Every table in the schema that holds data worth keeping, billing and savings
// alike. Two are left out on purpose: `oauth_codes`, which are single-use and
// expire in sixty seconds, and `oauth_tokens`, which hold hashed credentials and
// have no business in a file on disk. `agent_keys` comes WITHOUT its hashes,
// below, for the same reason.
const TABLES = [
  "orgs",
  "org_members",
  "issuers",
  "clients",
  "invoices",
  "invoice_items",
  "agent_keys",
  "oauth_clients",
  "agent_calls",
  "agent_writes",
  // The savings half. Only organisation #1 has any of this; for anybody else
  // these come back empty, which is the honest answer.
  "savings_plans",
  "savings_weeks",
  "week_entries",
  "week_expenses",
  "expense_items",
  "loans",
  "loan_payments",
  "vault_movements",
  // Per-ABN deductions: the other half of a tax year.
  "tax_deductions",
  // The thirty-day bin, included because a snapshot taken while something is in
  // it should be able to give it back.
  "deleted_plans",
];

// Defaults to a sibling of the repo, so backups never land inside a folder
// that gets committed, and the path works on any machine.
const outDir = process.argv[2] ?? path.resolve("..", "_backups_awesome");
mkdirSync(outDir, { recursive: true });

const snapshot = { taken_at: new Date().toISOString(), source: url, tables: {} };

for (const table of TABLES) {
  const { data, error } = await db.from(table).select("*");
  if (error) {
    console.error(`${table}: ${error.message}`);
    process.exit(1);
  }
  snapshot.tables[table] =
    table === "agent_keys"
      ? // Destructured only to drop it: a backup must never carry key material.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        data.map(({ key_hash, ...rest }) => rest)
      : data;
  console.log(`${table}: ${data.length}`);
}

const stamp = snapshot.taken_at.replace(/[:.]/g, "-");
const file = path.join(outDir, `awesome-backup-${stamp}.json`);
writeFileSync(file, JSON.stringify(snapshot, null, 2), "utf8");
console.log(`\nWritten: ${file}`);
