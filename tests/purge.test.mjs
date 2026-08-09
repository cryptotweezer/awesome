// Deleting abandoned trial businesses, and never deleting anything else.
//
//   node --env-file=.env.local --test tests/purge.test.mjs
//
// This is the only code in the system that deletes a whole business, so the
// test that matters most is the one proving it will not touch the business that
// owns the deployment, even when told to purge everything older than a moment
// ago.
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

/** A trial business, backdated so every activity signal looks ancient. */
async function makeStaleOrg(name) {
  const userId = randomUUID();
  const { data, error } = await db.rpc("create_org", {
    p_user_id: userId,
    p_email: `purge-${userId.slice(0, 8)}@example.test`,
    p_display_name: "Purge Test",
    p_name: name,
    p_issuer_name: name,
    p_tax_id: `7${userId.replace(/\D/g, "").slice(0, 10)}`,
  });
  assert.equal(error, null, error?.message);
  await db
    .from("orgs")
    .update({
      last_active_at: LONG_AGO,
      created_at: LONG_AGO,
      updated_at: LONG_AGO,
    })
    .eq("id", data.id);
  return data.id;
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
    await db.from("org_members").delete().eq("org_id", org.id);
    await db.from("orgs").delete().eq("id", org.id);
  }
});

describe("the deployment owner is never purged", () => {
  test("not even when purging everything older than a day", async () => {
    const { data, error } = await db.rpc("purge_stale_demo_orgs", { p_days: 1 });
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

    const { data, error } = await db.rpc("purge_stale_demo_orgs", { p_days: 30 });
    assert.equal(error, null, error?.message);
    assert.ok(
      (data ?? []).some((r) => r.purged_org_id === orgId),
      "the dormant business survived",
    );
  });

  test("nothing of it is left behind", async () => {
    for (const table of ["orgs", "org_members", "issuers", "clients", "invoices"]) {
      const column = table === "orgs" ? "id" : "org_id";
      const { count } = await db
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq(column, orgId);
      assert.equal(count, 0, `${table} still holds rows of the purged business`);
    }
  });
});

describe("activity is derived from the data, not just from signing in", () => {
  test("a business with a recent invoice survives, however old its login", async () => {
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

    // Everything about this business looks ancient except that it just invoiced.
    const { error } = await db.rpc("create_invoice", {
      p_client_id: client.id,
      p_issuer_id: issuers[0].id,
      p_invoice_date: new Date().toISOString().slice(0, 10),
      p_created_by: "PurgeTest",
      p_items: [{ rate: 10, service_date: "2026-08-01" }],
      p_internal_notes: null,
      p_org_id: orgId,
    });
    assert.equal(error, null, error?.message);

    const { data: purged } = await db.rpc("purge_stale_demo_orgs", { p_days: 30 });
    assert.ok(
      !(purged ?? []).some((r) => r.purged_org_id === orgId),
      "a business that invoiced today was treated as abandoned",
    );
  });
});
