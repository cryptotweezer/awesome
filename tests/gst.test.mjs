// GST: charged only by registered businesses, frozen on the invoice, and
// counted when the money arrives.
//
//   node --env-file=.env.local --test tests/gst.test.mjs
//
// The rule that needs proving is the one that costs money if it is wrong:
// registering today must not add tax to invoices already sent, and turning
// registration off must not quietly remove it from invoices where it was
// charged. Everything it creates is removed at the end, including on failure.
import { test, describe, after, before } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Run with: node --env-file=.env.local --test tests/gst.test.mjs");
  process.exit(1);
}

const db = createClient(url, key, {
  db: { schema: "awesome" },
  auth: { persistSession: false, autoRefreshToken: false },
});

const AWESOME_ORG_ID = "00000000-0000-0000-0000-000000000001";

const userId = randomUUID();
let orgId = null;
let issuerId = null;
let clientId = null;

before(async () => {
  const { data, error } = await db.rpc("create_org", {
    p_user_id: userId,
    p_email: `gst-${userId.slice(0, 8)}@example.test`,
    p_display_name: "GST Test",
    p_name: "GST Test Business",
    p_issuer_name: "GST Test Business",
    p_tax_id: `6${userId.replace(/\D/g, "").padEnd(10, "0").slice(0, 10)}`,
  });
  assert.equal(error, null, error?.message);
  orgId = data.id;

  const { data: issuers } = await db
    .from("issuers")
    .select("id")
    .eq("org_id", orgId);
  issuerId = issuers[0].id;

  const { data: client } = await db
    .from("clients")
    .insert({ org_id: orgId, name: "A Client", default_issuer_id: issuerId })
    .select("id")
    .single();
  clientId = client.id;
});

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

/** One invoice for the given amount, as a single line. */
async function invoiceFor(rate) {
  const { data, error } = await db.rpc("create_invoice", {
    p_client_id: clientId,
    p_issuer_id: issuerId,
    p_invoice_date: new Date().toISOString().slice(0, 10),
    p_created_by: "GstTest",
    p_items: [{ rate, description: "Work", service_date: "2026-08-01" }],
    p_internal_notes: null,
    p_org_id: orgId,
  });
  assert.equal(error, null, error?.message);
  return data;
}

async function setRegistered(value) {
  const { error } = await db
    .from("orgs")
    .update({ gst_registered: value })
    .eq("id", orgId);
  assert.equal(error, null, error?.message);
}

describe("a business that is not registered charges no GST", () => {
  test("its invoice carries a zero rate and no tax", async () => {
    const inv = await invoiceFor(110);
    assert.equal(Number(inv.gst_rate), 0);
    assert.equal(Number(inv.gst_amount), 0);
    assert.equal(Number(inv.total), 110);
  });
});

describe("a registered business charges GST inside the price", () => {
  let invoice = null;

  test("$110 is $100 plus $10 of GST, and the client still pays $110", async () => {
    await setRegistered(true);
    invoice = await invoiceFor(110);

    assert.equal(Number(invoice.gst_rate), 0.1);
    assert.equal(Number(invoice.gst_amount), 10);
    assert.equal(Number(invoice.total), 110, "the price changed, it must not");
  });

  test("editing the lines moves the GST with the total", async () => {
    const { error } = await db
      .from("invoice_items")
      .update({ rate: 220 })
      .eq("invoice_id", invoice.id);
    assert.equal(error, null, error?.message);

    const { data } = await db
      .from("invoices")
      .select("total, gst_amount")
      .eq("id", invoice.id)
      .single();
    assert.equal(Number(data.total), 220);
    assert.equal(Number(data.gst_amount), 20);
  });

  test("deregistering does not strip the tax off an invoice already issued", async () => {
    await setRegistered(false);

    const { data } = await db
      .from("invoices")
      .select("gst_rate, gst_amount")
      .eq("id", invoice.id)
      .single();
    assert.equal(Number(data.gst_rate), 0.1, "the frozen rate was rewritten");
    assert.equal(Number(data.gst_amount), 20);
  });

  test("and the next invoice goes back to no GST", async () => {
    const after = await invoiceFor(110);
    assert.equal(Number(after.gst_rate), 0);
    assert.equal(Number(after.gst_amount), 0);
  });
});

describe("GST is counted when the money arrives", () => {
  test("an unpaid invoice has no payment date", async () => {
    await setRegistered(true);
    const inv = await invoiceFor(55);
    assert.equal(inv.paid_at, null);
    assert.equal(Number(inv.gst_amount), 5);

    const { data: paid } = await db.rpc("mark_paid", {
      p_id: inv.id,
      p_org_id: orgId,
    });
    assert.ok(paid.paid_at, "a paid invoice has no payment date");

    const { data: back } = await db.rpc("mark_unpaid", {
      p_id: inv.id,
      p_org_id: orgId,
    });
    assert.equal(back.paid_at, null, "the payment date survived unpaying it");
  });
});

describe("the deployment owner is left out of all this", () => {
  test("Awesome is not registered and its invoices carry no GST", async () => {
    const { data: org } = await db
      .from("orgs")
      .select("gst_registered")
      .eq("id", AWESOME_ORG_ID)
      .single();
    assert.equal(org.gst_registered, false);

    const { count } = await db
      .from("invoices")
      .select("*", { count: "exact", head: true })
      .eq("org_id", AWESOME_ORG_ID)
      .gt("gst_amount", 0);
    assert.equal(count, 0, "an Awesome invoice grew a GST amount");
  });
});
