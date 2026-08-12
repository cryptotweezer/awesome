// Each business prints its own identity, and nobody else's.
//
//   node --env-file=<keys.env> --test tests/documents.test.mjs
//
// Rendering is where a leak would be most embarrassing and least visible: a
// guest's invoice carrying the host business's logo would hand them somebody
// else's brand, and no database check would ever catch it.
//
// The logo cannot be read out of a rendered PDF as text, so the signal used
// here is weight. The host's logo is a ~54 KB PNG, so its documents are far
// heavier than a document with no image embedded at all.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.AWESOME_BASE_URL ?? "http://localhost:3000";
const KEY_A = process.env.AWESOME_KEY_A;
const KEY_B = process.env.AWESOME_KEY_B;
if (!KEY_A || !KEY_B) {
  console.error("Set AWESOME_KEY_A and AWESOME_KEY_B (see scripts/seed-test-org.mjs).");
  process.exit(1);
}

async function call(key, tool, input = {}) {
  const res = await fetch(`${BASE}/api/agent/${tool}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(input),
  });
  return res.json();
}

async function invoicePdf(key) {
  const recent = await call(key, "recent_invoices", { limit: 1 });
  assert.equal(recent.ok, true, recent.error);
  assert.ok(recent.result.length > 0, "no invoice to render");

  const res = await call(key, "get_invoice_pdf", {
    invoice: recent.result[0].invoice_number,
    include_base64: true,
  });
  assert.equal(res.ok, true, res.error);
  return Buffer.from(res.result.pdf_base64, "base64");
}

let hosted = null;
let guest = null;

before(async () => {
  hosted = await invoicePdf(KEY_A);
  guest = await invoicePdf(KEY_B);
});

describe("both businesses get a real PDF", () => {
  test("the host's invoice renders", () => {
    assert.equal(hosted.subarray(0, 4).toString(), "%PDF");
  });

  test("the guest's invoice renders", () => {
    assert.equal(guest.subarray(0, 4).toString(), "%PDF");
  });
});

describe("the logo belongs to one business only", () => {
  test("the host's document carries its logo", () => {
    assert.ok(
      hosted.length > 40_000,
      `expected an embedded logo, got ${hosted.length} bytes`,
    );
  });

  test("the guest's document carries no logo at all", () => {
    assert.ok(
      guest.length < 20_000,
      `the guest document is ${guest.length} bytes, big enough to be carrying somebody else's logo`,
    );
  });

  test("the guest document is far lighter than the host's", () => {
    assert.ok(
      hosted.length > guest.length * 2,
      `host ${hosted.length} vs guest ${guest.length}: too close to be a different letterhead`,
    );
  });
});

describe("statements follow the same rule", () => {
  test("a guest statement renders without the host logo", async () => {
    const clients = await call(KEY_B, "list_clients");
    assert.equal(clients.ok, true);
    const res = await call(KEY_B, "get_client_statement", {
      client_id: clients.result[0].id,
      include_base64: true,
    });
    assert.equal(res.ok, true, res.error);
    const pdf = Buffer.from(res.result.pdf_base64, "base64");
    assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
    assert.ok(
      pdf.length < 20_000,
      `the guest statement is ${pdf.length} bytes, big enough to be carrying somebody else's logo`,
    );
  });
});

describe("a document is handed over as a link, not as 60,000 characters", () => {
  test("the default answer is a link, with no base64 in it", async () => {
    const recent = await call(KEY_A, "recent_invoices", { limit: 1 });
    const res = await call(KEY_A, "get_invoice_pdf", {
      invoice: recent.result[0].invoice_number,
    });
    assert.equal(res.ok, true, res.error);
    assert.ok(res.result.download_url?.includes("/api/agent/download/"));
    assert.match(res.result.filename, /\.pdf$/);
    assert.ok(res.result.size_bytes > 1000);
    assert.equal(
      res.result.pdf_base64,
      undefined,
      "the bytes came back unasked, which is what broke the agents",
    );
  });

  // The link is absolute and built from APP_URL, which points at the deployed
  // site even when the server under test is this laptop. What is being tested
  // here is the token and the route, so follow the path against whatever base
  // the suite was pointed at.
  const here = (url) => BASE + new URL(url).pathname;

  test("the link serves the PDF with no key at all", async () => {
    const recent = await call(KEY_A, "recent_invoices", { limit: 1 });
    const res = await call(KEY_A, "get_invoice_pdf", {
      invoice: recent.result[0].invoice_number,
    });
    const file = await fetch(here(res.result.download_url));
    assert.equal(file.status, 200);
    assert.equal(file.headers.get("content-type"), "application/pdf");
    const bytes = Buffer.from(await file.arrayBuffer());
    assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
  });

  test("a tampered token gets nothing", async () => {
    const recent = await call(KEY_A, "recent_invoices", { limit: 1 });
    const res = await call(KEY_A, "get_invoice_pdf", {
      invoice: recent.result[0].invoice_number,
    });
    const url = here(res.result.download_url).slice(0, -3) + "aaa";
    assert.equal((await fetch(url)).status, 404);
  });
});
