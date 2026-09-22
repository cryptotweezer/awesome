// The savings week, end to end, against the real database.
//
//   node --env-file=.env.local --test tests/savings-weeks.test.mjs
//
// The rules this proves are the ones that would be quiet if they broke:
//
//   * a week is created once, however many times the weeks are ensured
//   * an invoice raised inside a week appears in it, with its payment, and a
//     payment is never recorded twice
//   * a week finds its invoiced work by SERVICE DATE, so an invoice raised
//     weeks later, or one covering a whole month, still lands in the right week
//   * a cash client is refused an invoice, so the two halves cannot merge
//   * closing freezes the figures, and changing a standing expense afterwards
//     does not move a week that already happened
//   * reopening gives the week back, without the snapshot doubling the costs
//   * everything leaves by cascade when the business is deleted
//
// It works in a throwaway organisation of its own and deletes it at the end, so
// it never touches Awesome's data even when it fails halfway.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error(
    "Run with: node --env-file=.env.local --test tests/savings-weeks.test.mjs",
  );
}

const db = createClient(url, key, {
  db: { schema: "awesome" },
  auth: { persistSession: false, autoRefreshToken: false },
});

const ORG = randomUUID();
const addDays = (date, days) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
};

const MONDAY = "2026-03-02";
let planId;
let clientId;
let cashClientId;
let issuerId;
let weekId;
let fuelId;

async function ok(promise, what) {
  const { data, error } = await promise;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

before(async () => {
  await ok(
    db.from("orgs").insert({
      id: ORG,
      name: "Savings Week Test",
      is_demo: true,
      per_client_defaults: true,
      max_invoices: null,
      max_clients: null,
    }),
    "create org",
  );

  const issuer = await ok(
    db
      .from("issuers")
      .insert({
        org_id: ORG,
        full_name: "Savings Week Test",
        short_name: "Test",
        abn: "12345678901",
      })
      .select("id")
      .single(),
    "create issuer",
  );
  issuerId = issuer.id;

  const invoiced = await ok(
    db
      .from("clients")
      .insert({
        org_id: ORG,
        name: "Invoiced Client",
        billing_type: "invoice",
        cadence: "weekly",
        default_rate: 200,
        default_description: "Clean",
        default_issuer_id: issuerId,
        in_week_1: true,
        week_1_day: 1,
        week_1_seq: 1,
      })
      .select("id")
      .single(),
    "create invoiced client",
  );
  clientId = invoiced.id;

  const cash = await ok(
    db
      .from("clients")
      .insert({
        org_id: ORG,
        name: "Cash Client",
        billing_type: "cash",
        cadence: "weekly",
        default_rate: 150,
        in_week_1: true,
        week_1_day: 2,
        week_1_seq: 2,
      })
      .select("id")
      .single(),
    "create cash client",
  );
  cashClientId = cash.id;

  const fuel = await ok(
    db
      .from("expense_items")
      .insert({
        org_id: ORG,
        name: "Fuel",
        weekly_amount: 70,
        category: "australia",
      })
      .select("id")
      .single(),
    "create expense",
  );
  fuelId = fuel.id;

  const plan = await ok(
    db
      .from("savings_plans")
      .insert({
        org_id: ORG,
        weekly_target: 300,
        horizon_months: 24,
        starts_on: MONDAY,
      })
      .select("id, ends_on")
      .single(),
    "create plan",
  );
  planId = plan.id;

  const week = await ok(
    db
      .from("savings_weeks")
      .insert({
        org_id: ORG,
        plan_id: planId,
        week_start: MONDAY,
        week_end: addDays(MONDAY, 6),
        rotation_week: 1,
      })
      .select("*")
      .single(),
    "create week",
  );
  weekId = week.id;
});

after(async () => {
  await db.from("orgs").delete().eq("id", ORG);
});

describe("a savings week", () => {
  test("a week is unique per business and per start date", async () => {
    const { error } = await db.from("savings_weeks").insert({
      org_id: ORG,
      plan_id: planId,
      week_start: MONDAY,
      week_end: addDays(MONDAY, 6),
      rotation_week: 1,
    });
    assert.ok(
      error,
      "the same week was created twice: ensureWeeks would multiply a year of history on every page load",
    );
  });

  test("a cash client is refused an invoice", async () => {
    const { error } = await db.rpc("create_invoice", {
      p_client_id: cashClientId,
      p_issuer_id: issuerId,
      p_invoice_date: MONDAY,
      p_created_by: "test",
      p_items: [{ rate: "150", description: "Clean" }],
      p_internal_notes: null,
      p_org_id: ORG,
    });
    assert.ok(error, "a cash client was invoiced");
    assert.match(
      error.message,
      /cash client/i,
      "the refusal should say why, in the words of the business",
    );
  });

  // This is the query `billedWorkIn` runs. It is here because the whole link
  // between billing and the savings plan rests on two things the TypeScript
  // cannot prove on its own: that `invoice_items.org_id` is really stamped by
  // its trigger (the query filters on it, and an unstamped row would silently
  // vanish), and that a line's `service_date` survives `create_invoice`.
  test("a week finds work by service date, whenever it was billed", async () => {
    const tuesday = addDays(MONDAY, 1);
    const invoice = await ok(
      db.rpc("create_invoice", {
        p_client_id: clientId,
        p_issuer_id: issuerId,
        // Raised three weeks AFTER the work: keying off this date would leave
        // the week looking as if nothing had been billed.
        p_invoice_date: addDays(MONDAY, 21),
        p_created_by: "test",
        p_items: [{ rate: "210", description: "Clean", service_date: tuesday }],
        p_internal_notes: null,
        p_org_id: ORG,
      }),
      "create a late invoice",
    );

    const lines = await ok(
      db
        .from("invoice_items")
        .select("invoice_id, service_date, amount, org_id")
        .eq("org_id", ORG)
        .gte("service_date", MONDAY)
        .lte("service_date", addDays(MONDAY, 6)),
      "read the week's invoiced lines",
    );

    const mine = lines.filter((l) => l.invoice_id === invoice.id);
    assert.equal(
      mine.length,
      1,
      "the line was not found by its service date: the week cannot see its own invoiced work",
    );
    assert.equal(mine[0].org_id, ORG, "invoice_items.org_id was not stamped");
    assert.equal(Number(mine[0].amount), 210);
    assert.equal(mine[0].service_date, tuesday);
  });

  test("a monthly invoice belongs to each week it covers", async () => {
    const invoice = await ok(
      db.rpc("create_invoice", {
        p_client_id: clientId,
        p_issuer_id: issuerId,
        p_invoice_date: addDays(MONDAY, 27),
        p_created_by: "test",
        p_items: [
          { rate: "100", description: "Clean", service_date: addDays(MONDAY, 1) },
          { rate: "100", description: "Clean", service_date: addDays(MONDAY, 8) },
          { rate: "100", description: "Clean", service_date: addDays(MONDAY, 15) },
          { rate: "100", description: "Clean", service_date: addDays(MONDAY, 22) },
        ],
        p_internal_notes: null,
        p_org_id: ORG,
      }),
      "create a monthly invoice",
    );
    assert.equal(Number(invoice.total), 400);

    // Each week takes only its own line, which is what stops one invoice
    // counting four times over.
    for (const offset of [0, 7, 14, 21]) {
      const from = addDays(MONDAY, offset);
      const lines = await ok(
        db
          .from("invoice_items")
          .select("invoice_id, amount")
          .eq("org_id", ORG)
          .eq("invoice_id", invoice.id)
          .gte("service_date", from)
          .lte("service_date", addDays(from, 6)),
        "read one week of the monthly invoice",
      );
      assert.equal(lines.length, 1, `week starting ${from} did not get exactly its own line`);
      assert.equal(Number(lines[0].amount), 100);
    }
  });

  // The whole point of the third kind: the money arrives in the bank like an
  // invoiced client's, and no document is ever issued. If this were invoiceable
  // the week would go back to demanding an invoice that never comes.
  test("a transfer client is refused an invoice, like a cash one", async () => {
    const transferId = randomUUID();
    await ok(
      db.from("clients").insert({
        id: transferId,
        org_id: ORG,
        name: "Transfer Client",
        billing_type: "transfer",
        default_rate: "160",
        default_issuer_id: issuerId,
      }),
      "add a transfer client",
    );

    const { error } = await db.rpc("create_invoice", {
      p_client_id: transferId,
      p_issuer_id: issuerId,
      p_invoice_date: MONDAY,
      p_created_by: "test",
      p_items: [{ rate: "160", description: "Clean" }],
      p_internal_notes: null,
      p_org_id: ORG,
    });
    assert.ok(error, "a transfer client was invoiced");
    assert.match(
      error.message,
      /never invoiced/i,
      "the refusal should say why, in the words of the business",
    );

    // And the week can hold that client settled by transfer, which is the
    // state the old two-value column could not express.
    await ok(
      db.from("week_entries").insert({
        org_id: ORG,
        week_id: weekId,
        client_id: transferId,
        client_name: "Transfer Client",
        source: "rotation",
        status: "done",
        day: 3,
        amount: 160,
        method: "transfer",
        paid: false,
      }),
      "a week line settled by transfer",
    );
  });

  test("an invoice inside the week can be linked to its line", async () => {
    const invoice = await ok(
      db.rpc("create_invoice", {
        p_client_id: clientId,
        p_issuer_id: issuerId,
        p_invoice_date: addDays(MONDAY, 1),
        p_created_by: "test",
        p_items: [{ rate: "200", description: "Clean" }],
        p_internal_notes: null,
        p_org_id: ORG,
      }),
      "create invoice",
    );

    assert.equal(Number(invoice.total), 200);
    assert.ok(
      invoice.invoice_date >= MONDAY && invoice.invoice_date <= addDays(MONDAY, 6),
      "the invoice has to fall inside the week for the week to find it",
    );

    await ok(
      db.from("week_entries").insert({
        org_id: ORG,
        week_id: weekId,
        client_id: clientId,
        client_name: "Invoiced Client",
        source: "rotation",
        status: "done",
        day: 1,
        amount: Number(invoice.total),
        method: "account",
        paid: invoice.status === "paid",
        invoice_id: invoice.id,
      }),
      "link the entry",
    );

    // Paying the invoice is the ONE place a payment is recorded. The week reads
    // it; it does not keep a second copy that can disagree.
    await ok(
      db.rpc("mark_paid", { p_id: invoice.id, p_org_id: ORG }),
      "mark paid",
    );
    const paid = await ok(
      db
        .from("invoices")
        .select("status, paid_at")
        .eq("org_id", ORG)
        .eq("id", invoice.id)
        .single(),
      "read invoice",
    );
    assert.equal(paid.status, "paid");
    assert.ok(paid.paid_at, "a paid invoice records when");
  });

  test("one line per client per week", async () => {
    const { error } = await db.from("week_entries").insert({
      org_id: ORG,
      week_id: weekId,
      client_id: clientId,
      client_name: "Invoiced Client",
      source: "adhoc",
      amount: 50,
    });
    assert.ok(
      error,
      "the same client got two lines in one week: a second visit is extra work on the same line",
    );
  });

  test("a one-off job needs no client", async () => {
    await ok(
      db.from("week_entries").insert({
        org_id: ORG,
        week_id: weekId,
        client_id: null,
        client_name: "End of lease clean",
        source: "oneoff",
        status: "done",
        amount: 380,
        method: "cash",
        paid: true,
      }),
      "add a one-off",
    );

    // And a second one in the same week, which the unique key must allow:
    // client_id is null, and null is not equal to null in a unique index.
    await ok(
      db.from("week_entries").insert({
        org_id: ORG,
        week_id: weekId,
        client_id: null,
        client_name: "Office one-off",
        source: "oneoff",
        status: "done",
        amount: 120,
        method: "cash",
        paid: true,
      }),
      "add a second one-off",
    );
  });

  test("closing freezes the week, and a later price change cannot move it", async () => {
    const entries = await ok(
      db.from("week_entries").select("*").eq("org_id", ORG).eq("week_id", weekId),
      "read entries",
    );
    const income = entries
      .filter((e) => e.status === "done")
      .reduce((s, e) => s + Number(e.amount) + Number(e.extra_amount), 0);
    const expenses = 70;
    const saved = income - expenses;

    await ok(
      db.from("week_expenses").insert({
        org_id: ORG,
        week_id: weekId,
        expense_item_id: fuelId,
        name: "Fuel",
        category: "australia",
        amount: 70,
        kind: "snapshot",
      }),
      "snapshot the expense",
    );

    await ok(
      db
        .from("savings_weeks")
        .update({
          closed_at: new Date().toISOString(),
          closed_by: "test",
          income_total: income,
          expenses_total: expenses,
          saved_amount: saved,
          target_amount: 300,
        })
        .eq("org_id", ORG)
        .eq("id", weekId),
      "close the week",
    );

    // Fuel doubles from here on. The closed week must not notice.
    await ok(
      db
        .from("expense_items")
        .update({ weekly_amount: 140 })
        .eq("org_id", ORG)
        .eq("id", fuelId),
      "raise the standing cost",
    );

    const after = await ok(
      db
        .from("savings_weeks")
        .select("*")
        .eq("org_id", ORG)
        .eq("id", weekId)
        .single(),
      "re-read the week",
    );
    assert.equal(
      Number(after.expenses_total),
      70,
      "a closed week followed a price change made after it closed",
    );
    assert.equal(Number(after.saved_amount), saved);
  });

  test("reopening clears the frozen figures and the snapshot", async () => {
    await ok(
      db
        .from("week_expenses")
        .delete()
        .eq("org_id", ORG)
        .eq("week_id", weekId)
        .eq("kind", "snapshot"),
      "remove snapshots",
    );
    await ok(
      db
        .from("savings_weeks")
        .update({
          closed_at: null,
          closed_by: null,
          income_total: null,
          expenses_total: null,
          saved_amount: null,
          target_amount: null,
        })
        .eq("org_id", ORG)
        .eq("id", weekId),
      "reopen",
    );

    const week = await ok(
      db
        .from("savings_weeks")
        .select("*")
        .eq("org_id", ORG)
        .eq("id", weekId)
        .single(),
      "read the week",
    );
    assert.equal(week.closed_at, null);
    assert.equal(week.saved_amount, null);

    const left = await ok(
      db
        .from("week_expenses")
        .select("id")
        .eq("org_id", ORG)
        .eq("week_id", weekId)
        .eq("kind", "snapshot"),
      "read snapshots",
    );
    assert.equal(
      left.length,
      0,
      "a snapshot survived a reopen and would now be counted on top of the standing list",
    );
  });

  test("a deleted client leaves its history behind", async () => {
    const extra = await ok(
      db
        .from("clients")
        .insert({
          org_id: ORG,
          name: "Gone Tomorrow",
          billing_type: "cash",
          default_rate: 90,
        })
        .select("id")
        .single(),
      "create a client",
    );

    await ok(
      db.from("week_entries").insert({
        org_id: ORG,
        week_id: weekId,
        client_id: extra.id,
        client_name: "Gone Tomorrow",
        source: "adhoc",
        status: "done",
        amount: 90,
        method: "cash",
        paid: true,
      }),
      "record the work",
    );

    await ok(
      db.from("clients").delete().eq("org_id", ORG).eq("id", extra.id),
      "delete the client",
    );

    const line = await ok(
      db
        .from("week_entries")
        .select("client_id, client_name, amount")
        .eq("org_id", ORG)
        .eq("client_name", "Gone Tomorrow")
        .single(),
      "read the line",
    );
    assert.equal(line.client_id, null);
    assert.equal(
      line.client_name,
      "Gone Tomorrow",
      "the week forgot who the work was for when the client was deleted",
    );
  });

  // Deleting a plan is offered in the dashboard, and the one question worth
  // being sure about is whether it takes billing with it. It must not: the only
  // link between the two halves points from the week TO the invoice, so the
  // document outlives the record of the day it was for.
  //
  // Last but one on purpose: it deletes the week every test above works in, and
  // the only test after it deletes the whole business anyway.
  test("deleting the plan leaves every invoice alone", async () => {
    const before = await ok(
      db
        .from("invoices")
        .select("id, invoice_number")
        .eq("org_id", ORG)
        .order("invoice_number"),
      "read the invoices before",
    );
    assert.ok(before.length > 0, "nothing to prove: this org has no invoices");

    // Exactly what deletePlan() does: the plan row goes and its weeks follow
    // by cascade, which is the part worth proving.
    await ok(
      db.from("savings_plans").delete().eq("org_id", ORG).select("id"),
      "delete the plan",
    );

    const after = await ok(
      db
        .from("invoices")
        .select("id, invoice_number")
        .eq("org_id", ORG)
        .order("invoice_number"),
      "read the invoices after",
    );
    assert.deepEqual(
      after.map((i) => i.invoice_number),
      before.map((i) => i.invoice_number),
      "deleting the plan destroyed invoices",
    );

    const items = await ok(
      db.from("invoice_items").select("id").eq("org_id", ORG),
      "read the line items after",
    );
    assert.ok(items.length > 0, "deleting the plan destroyed the line items");

    // The week's own record does go, which is the point of the button.
    const weeksLeft = await ok(
      db.from("savings_weeks").select("id").eq("org_id", ORG),
      "read the weeks after",
    );
    assert.equal(
      weeksLeft.length,
      0,
      "the plan went but its weeks stayed: savings_weeks no longer cascades from the plan",
    );

    const entries = await ok(
      db.from("week_entries").select("id").eq("org_id", ORG),
      "read the week lines after",
    );
    assert.equal(
      entries.length,
      0,
      "the weeks were deleted but their lines survived: week_entries no longer cascades",
    );
  });

  test("nothing is left behind when the business goes", async () => {
    const gaps = await ok(db.rpc("org_cascade_gaps"), "cascade gaps");
    assert.deepEqual(
      gaps,
      [],
      "a table carrying org_id has no cascading key to orgs, so deleting a business would strand its rows",
    );

    await ok(db.from("orgs").delete().eq("id", ORG), "delete the org");

    for (const table of ["savings_weeks", "week_entries", "week_expenses"]) {
      const rows = await ok(
        db.from(table).select("id").eq("org_id", ORG),
        `read ${table}`,
      );
      assert.equal(rows.length, 0, `${table} kept rows after its business went`);
    }

    // Put it back so `after` has something harmless to delete.
    await ok(
      db.from("orgs").insert({ id: ORG, name: "Savings Week Test", is_demo: true }),
      "restore the org",
    );
  });
});
