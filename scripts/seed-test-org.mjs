// Prepare everything tests/isolation.test.mjs needs: a second organisation with
// its own data, and one agent key for each organisation.
//
//   node --env-file=.env.local scripts/seed-test-org.mjs
//   node --env-file=.env.local scripts/seed-test-org.mjs --cleanup
//
// The two keys are real credentials, so they are never printed. They are written
// to an env file OUTSIDE the repo and the test run reads them from there:
//
//   node --env-file=<that file> --test tests/isolation.test.mjs
//
// Both keys are labelled "isolation-test" and --cleanup deletes them along with
// the whole throwaway organisation.
import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const pepper = process.env.AGENT_KEY_PEPPER ?? "";
if (!url || !key) {
  console.error("Run with: node --env-file=.env.local scripts/seed-test-org.mjs");
  process.exit(1);
}

const db = createClient(url, key, {
  db: { schema: "awesome" },
  auth: { persistSession: false, autoRefreshToken: false },
});

const AWESOME_ORG_ID = "00000000-0000-0000-0000-000000000001";
const TEST_ORG_ID = "000000ff-0000-0000-0000-0000000000ff";
const LABEL = "isolation-test";
// A sibling of the repo: real keys must not sit inside a folder that gets
// committed, even a gitignored one.
const OUT_DIR = path.resolve("..", "_backups_awesome");
const OUT_FILE = path.join(OUT_DIR, "isolation-keys.env");

// Same derivation as src/lib/gateway/keys.ts. If it ever drifts, the minted key
// will not authenticate and the test fails loudly, which is the right outcome.
const hashKey = (raw) => createHash("sha256").update(pepper + raw).digest("hex");
const generateKey = () => `awsm_${randomBytes(24).toString("base64url")}`;

async function check({ error }, what) {
  if (error) {
    console.error(`${what}: ${error.message}`);
    process.exit(1);
  }
}

async function cleanup() {
  await check(await db.from("agent_keys").delete().eq("label", LABEL), "keys");
  // Explicit order: the org cascade would otherwise race the invoice -> client
  // and invoice -> issuer foreign keys.
  await check(
    await db.from("invoice_items").delete().eq("org_id", TEST_ORG_ID),
    "items",
  );
  await check(await db.from("invoices").delete().eq("org_id", TEST_ORG_ID), "invoices");
  await check(await db.from("clients").delete().eq("org_id", TEST_ORG_ID), "clients");
  await check(await db.from("issuers").delete().eq("org_id", TEST_ORG_ID), "issuers");
  await check(await db.from("orgs").delete().eq("id", TEST_ORG_ID), "org");
  console.log("Removed the test organisation and both isolation-test keys.");
}

if (process.argv.includes("--cleanup")) {
  await cleanup();
  process.exit(0);
}

// -- the throwaway organisation --------------------------------------------
await check(
  await db.from("orgs").upsert(
    {
      id: TEST_ORG_ID,
      name: "Test Guest Business",
      display_name: "Test Guest",
      tax_id_label: "ABN",
      address_line: "1 Nowhere Street",
      suburb: "Testville",
      state: "NSW",
      postcode: "2000",
      terms_days: 14,
      invoice_number_start: 1,
      is_demo: true,
      max_invoices: 2,
      max_clients: 1,
      max_agent_keys: 3,
      max_ai_messages: 20,
    },
    { onConflict: "id" },
  ),
  "org",
);

const { data: issuers } = await db
  .from("issuers")
  .select("id")
  .eq("org_id", TEST_ORG_ID);
let issuerId = issuers?.[0]?.id;
if (!issuerId) {
  const { data, error } = await db
    .from("issuers")
    .insert({
      org_id: TEST_ORG_ID,
      full_name: "Guest Owner",
      short_name: "Guest",
      abn: "99999999999",
    })
    .select("id")
    .single();
  await check({ error }, "issuer");
  issuerId = data.id;
}

const { data: clients } = await db
  .from("clients")
  .select("id")
  .eq("org_id", TEST_ORG_ID);
let clientId = clients?.[0]?.id;
if (!clientId) {
  const { data, error } = await db
    .from("clients")
    .insert({
      org_id: TEST_ORG_ID,
      name: "Guest Client",
      address_line: "2 Nowhere Street",
      default_issuer_id: issuerId,
      default_rate: 50,
    })
    .select("id")
    .single();
  await check({ error }, "client");
  clientId = data.id;
}

const { count } = await db
  .from("invoices")
  .select("*", { count: "exact", head: true })
  .eq("org_id", TEST_ORG_ID);
if (!count) {
  const { error } = await db.rpc("create_invoice", {
    p_client_id: clientId,
    p_issuer_id: issuerId,
    p_invoice_date: new Date().toISOString().slice(0, 10),
    p_created_by: "SeedScript",
    p_items: [{ rate: 50, quantity: 2, service_date: "2026-08-01" }],
    p_internal_notes: null,
    p_org_id: TEST_ORG_ID,
  });
  await check({ error }, "invoice");
}

// -- one key per organisation ----------------------------------------------
await check(await db.from("agent_keys").delete().eq("label", LABEL), "old keys");

const keyA = generateKey();
const keyB = generateKey();
await check(
  await db.from("agent_keys").insert([
    { org_id: AWESOME_ORG_ID, label: LABEL, key_hash: hashKey(keyA) },
    { org_id: TEST_ORG_ID, label: LABEL, key_hash: hashKey(keyB) },
  ]),
  "mint",
);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  OUT_FILE,
  [
    "# Throwaway keys for tests/isolation.test.mjs. Delete with --cleanup.",
    `AWESOME_BASE_URL=${process.env.AWESOME_BASE_URL ?? "http://localhost:3000"}`,
    `AWESOME_KEY_A=${keyA}`,
    `AWESOME_KEY_B=${keyB}`,
    "",
  ].join("\n"),
  "utf8",
);

console.log(`Test organisation ready. Keys written to ${OUT_FILE}`);
console.log(`Run: node --env-file="${OUT_FILE}" --test tests/isolation.test.mjs`);
