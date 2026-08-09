// Full snapshot of the `awesome` schema straight to a JSON file on disk.
//
//   node --env-file=.env.local scripts/db-backup.mjs [outDir]
//
// Same shape as /backup/download, but runnable without a browser session, which
// is what a migration needs. `agent_keys` rows are included WITHOUT their
// hashes so the file is a safety net and not a set of credentials.
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

const TABLES = [
  "company_profile",
  "issuers",
  "clients",
  "invoices",
  "invoice_items",
  "agent_keys",
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
    table === "agent_keys" ? data.map(({ key_hash, ...rest }) => rest) : data;
  console.log(`${table}: ${data.length}`);
}

const stamp = snapshot.taken_at.replace(/[:.]/g, "-");
const file = path.join(outDir, `awesome-backup-${stamp}.json`);
writeFileSync(file, JSON.stringify(snapshot, null, 2), "utf8");
console.log(`\nWritten: ${file}`);
