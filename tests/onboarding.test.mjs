// Signing up creates a working business, once, with trial limits attached.
//
//   node --env-file=.env.local --test tests/onboarding.test.mjs
//
// This talks to the database directly rather than through the browser, because
// what matters here is that awesome.create_org() is atomic and that a new
// business lands with the right defaults: its own numbering from #1, the trial
// quotas, and exactly one issuer so the invoice form never shows a picker.
//
// Everything it creates is removed at the end, including on failure.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Run with: node --env-file=.env.local --test tests/onboarding.test.mjs");
  process.exit(1);
}

const db = createClient(url, key, {
  db: { schema: "awesome" },
  auth: { persistSession: false, autoRefreshToken: false },
});

const AWESOME_ORG_ID = "00000000-0000-0000-0000-000000000001";
const userId = randomUUID();
const email = `onboarding-test-${userId.slice(0, 8)}@example.test`;
let orgId = null;

async function createOrg(overrides = {}) {
  return db.rpc("create_org", {
    p_user_id: userId,
    p_email: email,
    p_display_name: "Test Owner",
    p_name: "Bright Clean Pty Ltd",
    p_issuer_name: "Bright Clean Pty Ltd",
    p_tax_id: `9${userId.replace(/\D/g, "").padEnd(10, "0").slice(0, 10)}`,
    p_tax_id_label: "ABN",
    p_entity_type: "company",
    p_terms_days: 21,
    ...overrides,
  });
}

after(async () => {
  if (!orgId) {
    await db.from("org_members").delete().eq("user_id", userId);
    return;
  }
  await db.from("invoice_items").delete().eq("org_id", orgId);
  await db.from("invoices").delete().eq("org_id", orgId);
  await db.from("clients").delete().eq("org_id", orgId);
  await db.from("issuers").delete().eq("org_id", orgId);
  await db.from("org_members").delete().eq("org_id", orgId);
  await db.from("orgs").delete().eq("id", orgId);
});

describe("creating a business", () => {
  test("returns an org with trial limits and its own numbering", async () => {
    const { data, error } = await createOrg();
    assert.equal(error, null, error?.message);
    orgId = data.id;

    assert.equal(data.name, "Bright Clean Pty Ltd");
    assert.equal(data.entity_type, "company");
    assert.equal(data.terms_days, 21);
    assert.equal(data.is_demo, true, "a new business must be a trial");
    assert.equal(data.invoice_number_start, 1);
    assert.equal(data.next_invoice_number, 1, "numbering starts at 1, not 1945");
    assert.equal(data.max_invoices, 20);
    assert.equal(data.max_clients, 10);
    assert.equal(data.max_agent_keys, 3);
    assert.equal(data.max_ai_messages, 20);
    assert.equal(data.ai_messages_used, 0);
    assert.notEqual(data.id, AWESOME_ORG_ID);
  });

  test("the owner is a member and signs with their display name", async () => {
    const { data } = await db
      .from("org_members")
      .select("*")
      .eq("org_id", orgId)
      .single();
    assert.equal(data.user_id, userId);
    assert.equal(data.display_name, "Test Owner");
    assert.equal(data.role, "owner");
  });

  test("exactly one issuer, so no ABN picker is ever shown", async () => {
    const { data } = await db.from("issuers").select("*").eq("org_id", orgId);
    assert.equal(data.length, 1);
    assert.equal(data[0].full_name, "Bright Clean Pty Ltd");
  });

  test("the same account cannot create a second business", async () => {
    const { error } = await createOrg({ p_name: "Second Business" });
    assert.ok(error, "a second business was allowed");
    assert.match(error.message, /already belongs/i);
  });

  test("nothing was left behind by the refused second attempt", async () => {
    const { count } = await db
      .from("orgs")
      .select("*", { count: "exact", head: true })
      .eq("name", "Second Business");
    assert.equal(count, 0);
  });
});

describe("a brand new business, with nothing in it yet", () => {
  // The very first screen anybody sees after signing up. Every one of these
  // runs before they have a single client, so an empty result that comes back
  // as no row at all, rather than as zeros, is a crashed dashboard on someone's
  // first impression.
  const reads = [
    ["business_snapshot", {}],
    ["who_owes", {}],
    ["overdue_invoices", {}],
    ["recent_invoices", { p_name: null, p_limit: 10 }],
    ["find_invoices", {
      p_client: null, p_issuer: null, p_status: null,
      p_from: null, p_to: null, p_limit: 20,
    }],
    ["fy_summary", { p_fy_start: null }],
    ["billed_in_period", { p_from: "2000-01-01", p_to: "2100-01-01", p_issuer: null }],
    ["client_summary", { p_name: "anything" }],
    ["client_account", { p_name: "anything" }],
    ["peek_next_invoice_number", {}],
  ];

  for (const [fn, args] of reads) {
    test(`${fn} answers without data to answer from`, async () => {
      const { data, error } = await db.rpc(fn, { ...args, p_org_id: orgId });
      assert.equal(error, null, error?.message);
      assert.notEqual(data, undefined, `${fn} returned nothing at all`);
    });
  }

  test("the snapshot reads as zeros, not as an empty result", async () => {
    const { data } = await db.rpc("business_snapshot", { p_org_id: orgId });
    assert.equal(data.length, 1, "an empty business produced no snapshot row");
    assert.equal(Number(data[0].outstanding_amount), 0);
    assert.equal(Number(data[0].billed_all_time), 0);
    assert.equal(data[0].outstanding_count, 0);
  });

  test("their first invoice will be #1", async () => {
    const { data } = await db.rpc("peek_next_invoice_number", { p_org_id: orgId });
    assert.equal(Number(data), 1);
  });
});

describe("a business cannot be created half-formed", () => {
  const blankUser = randomUUID();

  for (const [what, overrides] of [
    ["no name", { p_name: "   " }],
    ["no tax number", { p_tax_id: "" }],
  ]) {
    test(`${what} is refused`, async () => {
      const { error } = await createOrg({
        p_user_id: blankUser,
        p_email: "blank@example.test",
        ...overrides,
      });
      assert.ok(error, `${what} was accepted`);
    });
  }

  test("no membership survives a refused attempt", async () => {
    const { count } = await db
      .from("org_members")
      .select("*", { count: "exact", head: true })
      .eq("user_id", blankUser);
    assert.equal(count, 0, "a refused signup left a membership behind");
  });
});

describe("the trial limits are real", () => {
  test("the client quota stops at 10", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      org_id: orgId,
      name: `Client ${i + 1}`,
    }));
    const { error: bulk } = await db.from("clients").insert(rows);
    assert.equal(bulk, null, bulk?.message);

    const { error } = await db
      .from("clients")
      .insert({ org_id: orgId, name: "One too many" });
    assert.ok(error, "the 11th client was allowed");
    assert.match(error.message, /Trial limit reached/i);
  });

  test("Awesome itself has no quota to hit", async () => {
    const { data } = await db
      .from("orgs")
      .select("max_invoices, max_clients, max_agent_keys, is_demo")
      .eq("id", AWESOME_ORG_ID)
      .single();
    assert.equal(data.is_demo, false);
    assert.equal(data.max_invoices, null);
    assert.equal(data.max_clients, null);
    assert.equal(data.max_agent_keys, null);
  });
});
