// Tenant isolation: the one thing this app is not allowed to get wrong.
//
//   node --test tests/isolation.test.mjs
//
// Needs a running app and two agent keys from two different organisations:
//
//   AWESOME_BASE_URL   default http://localhost:3000
//   AWESOME_KEY_A      key belonging to organisation A (the real business)
//   AWESOME_KEY_B      key belonging to organisation B (a throwaway org)
//
// Seed org B with `node --env-file=.env.local scripts/seed-test-org.mjs`.
//
// The test never hardcodes real data. It asks key A what it can see, turns that
// into a set of markers (client names, ABNs, invoice numbers, business name),
// and then asserts that not one of those strings ever comes back to key B, from
// any tool. Writes are checked the other way round: B must be refused when it
// aims at A's rows, because knowing a uuid must not be enough to touch it.
import { test, before, describe } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.AWESOME_BASE_URL ?? "http://localhost:3000";
const KEY_A = process.env.AWESOME_KEY_A;
const KEY_B = process.env.AWESOME_KEY_B;

if (!KEY_A || !KEY_B) {
  console.error("Set AWESOME_KEY_A and AWESOME_KEY_B (two different organisations).");
  process.exit(1);
}

async function call(key, tool, input = {}) {
  const res = await fetch(`${BASE}/api/agent/${tool}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => ({ ok: false, error: `non-JSON ${res.status}` }));
  return { status: res.status, ...body };
}

/** Strings that belong to organisation A and must never reach organisation B. */
const markers = new Set();
/** An invoice of A's, used to prove that knowing a uuid buys you nothing. */
let victim = null;

function addMarker(value) {
  if (typeof value === "string" && value.trim().length >= 4) markers.add(value.trim());
}

before(async () => {
  const clients = await call(KEY_A, "list_clients");
  assert.equal(clients.ok, true, `key A cannot read its own clients: ${clients.error}`);
  assert.ok(clients.result.length > 0, "organisation A has no clients, nothing to protect");

  for (const c of clients.result) {
    addMarker(c.name);
    addMarker(c.address_line);
    addMarker(c.issuer?.abn);
  }

  const recent = await call(KEY_A, "recent_invoices", { limit: 50 });
  assert.equal(recent.ok, true);
  assert.ok(recent.result.length > 0, "organisation A has no invoices, nothing to protect");

  const number = recent.result[0].invoice_number;
  const invoice = await call(KEY_A, "get_invoice", { invoice_number: number });
  assert.equal(invoice.ok, true);
  victim = { id: invoice.result.id, number };
  addMarker(invoice.result.issuer_name);
  addMarker(invoice.result.issuer_abn);
  addMarker(invoice.result.bill_to_name);
});

/** Fails with the offending marker named, so a leak is obvious at a glance. */
function assertClean(label, payload) {
  const text = JSON.stringify(payload ?? null);
  for (const marker of markers) {
    assert.ok(
      !text.includes(marker),
      `${label} leaked organisation A data: found ${JSON.stringify(marker)}`,
    );
  }
}

describe("reads never cross the organisation boundary", () => {
  const reads = [
    ["business_snapshot", {}],
    ["who_owes", {}],
    ["overdue_invoices", {}],
    ["recent_invoices", { limit: 50 }],
    ["list_clients", {}],
    ["fy_summary", {}],
    ["billed_in_period", { from: "2000-01-01", to: "2100-01-01" }],
    ["find_invoices", { limit: 50 }],
    // Loose ilike matching is the easiest leak in the codebase: a single letter
    // used to be enough to pull back every client in the database.
    ["find_invoices", { client: "a", limit: 50 }],
    ["client_account", { name: "a" }],
    ["client_summary", { name: "a" }],
    ["create_backup", {}],
  ];

  for (const [tool, input] of reads) {
    test(`${tool} ${JSON.stringify(input)}`, async () => {
      const res = await call(KEY_B, tool, input);
      assertClean(tool, res);
    });
  }

  test("every marker is searched by name", async () => {
    for (const marker of markers) {
      const res = await call(KEY_B, "find_invoices", { client: marker, limit: 50 });
      assertClean(`find_invoices(${marker})`, res);
      const account = await call(KEY_B, "client_account", { name: marker });
      assertClean(`client_account(${marker})`, account);
    }
  });

  test("get_invoice by A's number returns nothing to B", async () => {
    const res = await call(KEY_B, "get_invoice", { invoice_number: victim.number });
    assertClean("get_invoice(number)", res);
  });

  test("get_invoice by A's uuid returns nothing to B", async () => {
    const res = await call(KEY_B, "get_invoice", { invoice_id: victim.id });
    assertClean("get_invoice(uuid)", res);
  });

  test("get_invoice_pdf of A's invoice is refused", async () => {
    const res = await call(KEY_B, "get_invoice_pdf", { invoice_number: victim.number });
    assert.equal(res.ok, false, "B was handed a PDF of A's invoice");
  });
});

describe("writes never cross the organisation boundary", () => {
  const writes = [
    ["mark_paid", { invoice_id: null }],
    ["mark_unpaid", { invoice_id: null }],
    ["cancel_invoice", { invoice_id: null }],
    ["reactivate_invoice", { invoice_id: null }],
    ["update_invoice", { invoice_id: null, items: [{ rate: 1, service_date: "2026-01-01" }] }],
    ["delete_invoice", { invoice_id: null, confirm: true }],
  ];

  for (const [tool, input] of writes) {
    test(`${tool} on A's invoice is refused`, async () => {
      const res = await call(KEY_B, tool, { ...input, invoice_id: victim.id });
      assert.equal(res.ok, false, `B was allowed to ${tool} an invoice of A's`);

      // And the invoice is still there, untouched.
      const check = await call(KEY_A, "get_invoice", { invoice_number: victim.number });
      assert.equal(check.ok, true, `${tool} destroyed A's invoice`);
    });
  }
});

describe("organisation A is unaffected", () => {
  test("A still sees its own data", async () => {
    const res = await call(KEY_A, "business_snapshot");
    assert.equal(res.ok, true);
    assert.ok(res.result.billed_all_time > 0, "organisation A lost its history");
  });

  test("a revoked or unknown key gets nothing", async () => {
    const res = await call("awsm_this_key_does_not_exist", "list_clients");
    assert.equal(res.status, 401);
    assertClean("unauthenticated", res);
  });
});
