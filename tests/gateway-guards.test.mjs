// The two things that stand between an agent and a mess: a retry that cannot
// bill somebody twice, and a client who can be put away without being erased.
//
//   node --env-file=<keys.env> --test tests/gateway-guards.test.mjs
//
// Runs against the throwaway organisation (AWESOME_KEY_B), never the real one,
// because every test here writes. It cleans up after itself: the invoice it
// raises is deleted and the client it archives is restored.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.AWESOME_BASE_URL ?? "http://localhost:3000";
const KEY = process.env.AWESOME_KEY_B;
if (!KEY) {
  console.error("Set AWESOME_KEY_B (see scripts/seed-test-org.mjs).");
  process.exit(1);
}

const call = async (tool, body = {}) => {
  const res = await fetch(`${BASE}/api/agent/${tool}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

/** A value nothing else in the database can collide with. */
const stamp = Date.now();
const DATE = "2026-08-21";
let created = null;

after(async () => {
  if (created) await call("delete_invoice", { invoice: created, confirm: true });
});

describe("a retry cannot bill twice", () => {
  test("the same idempotency key answers with the same invoice", async () => {
    const args = {
      client: "Guest Client",
      invoice_date: DATE,
      idempotency_key: `test-${stamp}`,
      items: [
        { service_date: DATE, rate: 111.11, description: `Retry guard ${stamp}` },
      ],
    };

    const first = await call("create_invoice", args);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    created = first.body.result.invoice_number;
    assert.ok(created, "no invoice number came back");

    // What an agent does when its request timed out and it has no idea
    // whether the invoice exists.
    const retry = await call("create_invoice", args);
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal(
      retry.body.result.invoice_number,
      created,
      "the retry raised a SECOND invoice",
    );
  });

  test("an identical invoice with no key is refused, and says which one exists", async () => {
    const again = await call("create_invoice", {
      client: "Guest Client",
      invoice_date: DATE,
      items: [
        { service_date: DATE, rate: 111.11, description: `Retry guard ${stamp}` },
      ],
    });
    assert.equal(again.status, 400);
    assert.ok(
      again.body.error.startsWith(`Invoice ${created} already bills`),
      again.body.error,
    );
    assert.match(again.body.error, /allow_duplicate/);
  });
});

describe("a client can be put away, and only erased if never billed", () => {
  test("archiving and restoring are the same tool", async () => {
    const list = await call("list_clients");
    const client = list.body.result.find((c) => c.name === "Guest Client");
    assert.ok(client, "the seeded client is missing");

    const archived = await call("update_client", {
      id: client.id,
      is_active: false,
    });
    assert.equal(archived.status, 200, JSON.stringify(archived.body));
    assert.equal(archived.body.result.is_active, false);

    const restored = await call("update_client", { id: client.id, is_active: true });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.result.is_active, true);
  });

  test("deleting an invoiced client is refused in the words of the business", async () => {
    const refused = await call("delete_client", {
      client: "Guest Client",
      confirm: true,
    });
    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /invoice/i);
  });

  test("deleting without confirm:true is refused before anything happens", async () => {
    const refused = await call("delete_client", { client: "Guest Client" });
    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /confirm/);
  });
});
