// Deleting trial businesses on the 1st of the month, and never deleting
// anything else.
//
//   node --env-file=.env.local --test tests/purge.test.mjs
//
// This is the only code in the system that deletes a whole business, so the
// test that matters most is the one proving it will not touch the business that
// owns the deployment, even when aimed straight at it.
//
// Every call here names the business it is about (see `purge` below). Running
// the purge unaimed against a real database deletes real trial accounts, and on
// 2026-08-10 this file did exactly that.
import { test, describe, after, before } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Run with: node --env-file=.env.local --test tests/purge.test.mjs");
  process.exit(1);
}

const db = createClient(url, key, {
  db: { schema: "awesome" },
  auth: { persistSession: false, autoRefreshToken: false },
});

const AWESOME_ORG_ID = "00000000-0000-0000-0000-000000000001";
const LONG_AGO = "2020-01-01T00:00:00Z";

/**
 * Run the purge against ONE business, never the whole database.
 *
 * On 2026-08-10 this file called the purge unaimed and deleted a real guest
 * account: the function cannot tell a test business from somebody's actual
 * work, so "purge everything older than a day" meant exactly that. Every call
 * here names its target, which still proves both halves of the rule, because
 * the is_demo and age conditions are checked inside the function.
 */
function purge(days, orgId) {
  return db.rpc("purge_stale_demo_orgs", { p_days: days, p_org_id: orgId });
}

/** A trial business, backdated so every activity signal looks ancient. */
async function makeStaleOrg(name) {
  const orgId = await makeFreshOrg(name);
  await db
    .from("orgs")
    .update({
      last_active_at: LONG_AGO,
      created_at: LONG_AGO,
      updated_at: LONG_AGO,
    })
    .eq("id", orgId);
  return orgId;
}

/** A trial business created just now, the way somebody signing up gets one. */
async function makeFreshOrg(name) {
  const userId = randomUUID();
  const { data, error } = await db.rpc("create_org", {
    p_user_id: userId,
    p_email: `purge-${userId.slice(0, 8)}@example.test`,
    p_display_name: "Purge Test",
    p_name: name,
    p_issuer_name: name,
    p_tax_id: `7${userId.replace(/\D/g, "").padEnd(10, "0").slice(0, 10)}`,
  });
  assert.equal(error, null, error?.message);
  return data.id;
}

/**
 * Every table that carries an org_id. Not the four the delete functions name:
 * the whole list, because the point of the change on 2026-08-21 is that the
 * other six leave by cascade and nobody has to remember them.
 */
const ORG_TABLES = [
  "orgs",
  "org_members",
  "issuers",
  "clients",
  "invoices",
  "invoice_items",
  "agent_keys",
  "agent_calls",
  "agent_writes",
  "oauth_codes",
  "oauth_tokens",
];

async function assertNothingLeft(orgId, what) {
  for (const table of ORG_TABLES) {
    const column = table === "orgs" ? "id" : "org_id";
    const { count, error } = await db
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq(column, orgId);
    assert.equal(error, null, error?.message);
    assert.equal(count, 0, `${table} still holds rows of the ${what} business`);
  }
}

let awesomeBefore = null;

before(async () => {
  const { data } = await db
    .from("orgs")
    .select("id, name, is_demo")
    .eq("id", AWESOME_ORG_ID)
    .single();
  awesomeBefore = data;
  assert.equal(
    data.is_demo,
    false,
    "the deployment owner must not be marked as a trial",
  );
});

after(async () => {
  // Anything the tests created and the purge did not take.
  const { data } = await db.from("orgs").select("id").ilike("name", "Purge Test%");
  for (const org of data ?? []) {
    await db.from("invoice_items").delete().eq("org_id", org.id);
    await db.from("invoices").delete().eq("org_id", org.id);
    await db.from("clients").delete().eq("org_id", org.id);
    await db.from("issuers").delete().eq("org_id", org.id);
    await db.from("orgs").delete().eq("id", org.id);
  }
});

describe("the deployment owner is never purged", () => {
  test("not even when aimed straight at it, at a day old", async () => {
    const { data, error } = await purge(1, AWESOME_ORG_ID);
    assert.equal(error, null, error?.message);

    const purgedIds = (data ?? []).map((r) => r.purged_org_id);
    assert.ok(
      !purgedIds.includes(AWESOME_ORG_ID),
      "the deployment owner was purged",
    );

    const { data: still } = await db
      .from("orgs")
      .select("id, name")
      .eq("id", AWESOME_ORG_ID)
      .maybeSingle();
    assert.ok(still, "the deployment owner no longer exists");
    assert.equal(still.name, awesomeBefore.name);
  });

  test("its invoices are still there", async () => {
    const { count } = await db
      .from("invoices")
      .select("*", { count: "exact", head: true })
      .eq("org_id", AWESOME_ORG_ID);
    assert.ok((count ?? 0) > 0, "the deployment owner lost its invoices");
  });
});

describe("an abandoned trial is removed completely", () => {
  let orgId = null;

  test("a dormant trial business is purged", async () => {
    orgId = await makeStaleOrg("Purge Test Dormant");

    const { data, error } = await purge(30, orgId);
    assert.equal(error, null, error?.message);
    assert.ok(
      (data ?? []).some((r) => r.purged_org_id === orgId),
      "the dormant business survived",
    );
  });

  test("nothing of it is left behind", async () => {
    await assertNothingLeft(orgId, "purged");
  });
});

describe("the purge can be aimed at one business", () => {
  test("an equally old trial standing next to it is untouched", async () => {
    const target = await makeStaleOrg("Purge Test Target");
    const bystander = await makeStaleOrg("Purge Test Bystander");

    const { data, error } = await purge(30, target);
    assert.equal(error, null, error?.message);

    const purgedIds = (data ?? []).map((r) => r.purged_org_id);
    assert.deepEqual(purgedIds, [target], "the purge went past its target");

    const { data: still } = await db
      .from("orgs")
      .select("id")
      .eq("id", bystander)
      .maybeSingle();
    assert.ok(still, "a business nobody asked about was deleted");
  });
});

describe("closing your own account", () => {
  test("the deployment owner cannot be closed, even when named directly", async () => {
    const { error } = await db.rpc("delete_demo_org", { p_org_id: AWESOME_ORG_ID });
    assert.ok(error, "delete_demo_org accepted the deployment owner");
    assert.match(error.message, /not a trial/);

    const { data: still } = await db
      .from("orgs")
      .select("id, name")
      .eq("id", AWESOME_ORG_ID)
      .maybeSingle();
    assert.ok(still, "the deployment owner no longer exists");
    assert.equal(still.name, awesomeBefore.name);

    const { count } = await db
      .from("invoices")
      .select("*", { count: "exact", head: true })
      .eq("org_id", AWESOME_ORG_ID);
    assert.ok((count ?? 0) > 0, "the deployment owner lost its invoices");
  });

  test("a business that does not exist is refused too", async () => {
    const { error } = await db.rpc("delete_demo_org", { p_org_id: randomUUID() });
    assert.ok(error, "delete_demo_org accepted a business that does not exist");
  });

  test("a trial closes itself and leaves nothing behind", async () => {
    const orgId = await makeStaleOrg("Purge Test Closing");

    const { data: name, error } = await db.rpc("delete_demo_org", {
      p_org_id: orgId,
    });
    assert.equal(error, null, error?.message);
    assert.equal(name, "Purge Test Closing");

    await assertNothingLeft(orgId, "closed");
  });
});

describe("being busy never saves a trial", () => {
  test("a business that invoiced today is purged anyway", async () => {
    const orgId = await makeStaleOrg("Purge Test Working");

    const { data: issuers } = await db
      .from("issuers")
      .select("id")
      .eq("org_id", orgId);
    const { data: client } = await db
      .from("clients")
      .insert({ org_id: orgId, name: "Someone", default_issuer_id: issuers[0].id })
      .select("id")
      .single();

    // Everything about this business looks ancient except that it just
    // invoiced. Under the old rule that saved it; under this one nothing does,
    // because a trial is not storage.
    const { error } = await db.rpc("create_invoice", {
      p_client_id: client.id,
      p_issuer_id: issuers[0].id,
      p_invoice_date: new Date().toISOString().slice(0, 10),
      p_created_by: "PurgeTest",
      p_items: [{ rate: 10, service_date: "2026-08-01", description: "Work" }],
      p_internal_notes: null,
      p_org_id: orgId,
    });
    assert.equal(error, null, error?.message);

    const { data: purged } = await purge(30, orgId);
    assert.ok(
      (purged ?? []).some((r) => r.purged_org_id === orgId),
      "a trial older than a month survived because it was busy",
    );
  });

  test("an age of 30 days still spares a trial that signed up today", async () => {
    const orgId = await makeFreshOrg("Purge Test Fresh");

    const { data: purged } = await purge(30, orgId);
    assert.ok(
      !(purged ?? []).some((r) => r.purged_org_id === orgId),
      "a business that signed up minutes ago was deleted",
    );
  });
});

/**
 * The monthly sweep: p_days = 0, which means every trial regardless of age.
 * This is what the cron passes on the 1st, and the only value that ignores the
 * sign-up date, so it is also the one that has to be proven harmless to Awesome.
 */
describe("the monthly sweep takes every trial, whatever its age", () => {
  test("a trial that signed up minutes ago goes too", async () => {
    const orgId = await makeFreshOrg("Purge Test Sweep");

    const { data, error } = await purge(0, orgId);
    assert.equal(error, null, error?.message);
    assert.ok(
      (data ?? []).some((r) => r.purged_org_id === orgId),
      "the sweep left a trial behind",
    );
    await assertNothingLeft(orgId, "swept");
  });

  test("the deployment owner survives it, aimed straight at it", async () => {
    const { data, error } = await purge(0, AWESOME_ORG_ID);
    assert.equal(error, null, error?.message);
    assert.deepEqual(data ?? [], [], "the sweep reached the deployment owner");

    const { data: still } = await db
      .from("orgs")
      .select("id, name")
      .eq("id", AWESOME_ORG_ID)
      .maybeSingle();
    assert.ok(still, "the deployment owner no longer exists");
    assert.equal(still.name, awesomeBefore.name);

    const { count } = await db
      .from("invoices")
      .select("*", { count: "exact", head: true })
      .eq("org_id", AWESOME_ORG_ID);
    assert.ok((count ?? 0) > 0, "the deployment owner lost its invoices");
  });
});

/**
 * Deleting a business names four tables and leaves the rest to ON DELETE
 * CASCADE, which is only safe while every table with an org_id has that
 * constraint. Nothing in Postgres enforces it, so this is the enforcement: a
 * table added without it fails here, not in six months when the audit log has
 * a million rows belonging to businesses that no longer exist.
 */
describe("no table can quietly keep the rows of a deleted business", () => {
  test("every table with an org_id cascades from orgs", async () => {
    const { data, error } = await db.rpc("org_cascade_gaps");
    assert.equal(error, null, error?.message);
    assert.deepEqual(
      data ?? [],
      [],
      "a table carries org_id without a cascading foreign key to orgs",
    );
  });

  test("the audit log and the retry guard leave with the business", async () => {
    const orgId = await makeFreshOrg("Purge Test Trail");

    // The two append-only tables, written by the gateway on every tool call.
    // Neither is named by any delete: they leave by cascade or not at all.
    const { error: callError } = await db.from("agent_calls").insert({
      org_id: orgId,
      credential_label: "Purge Test",
      via: "key",
      tool: "list_clients",
      outcome: "ok",
    });
    assert.equal(callError, null, callError?.message);

    const { error: writeError } = await db.from("agent_writes").insert({
      org_id: orgId,
      tool: "create_invoice",
      idempotency_key: `purge-test-${orgId}`,
      result: {},
    });
    assert.equal(writeError, null, writeError?.message);

    const { data, error } = await purge(0, orgId);
    assert.equal(error, null, error?.message);
    assert.ok((data ?? []).some((r) => r.purged_org_id === orgId));

    await assertNothingLeft(orgId, "swept");
  });
});
