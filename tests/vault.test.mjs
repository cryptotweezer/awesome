// The vault, against the real database.
//
//   node --env-file=.env.local --test tests/vault.test.mjs
//
// The vault holds no balance. It is the weeks that closed plus the movements
// recorded against them, and that is exactly what makes it worth a test: every
// rule below is one that would break silently.
//
//   * a closed week's CONFIRMED saving is what lands in Vault AUS, not the
//     excess the week was worth
//   * a transfer moves money from AUS to COL and takes the rate of that day
//     with it, so the pesos can be read back
//   * correcting a week months later corrects the vault, because there is no
//     deposit row holding the old figure
//   * the database refuses a withdrawal with no reason and a transfer out of
//     COL, which are the two rows nobody could explain afterwards
//   * the movements leave by cascade when the business is deleted
//
// It works in a throwaway organisation of its own and deletes it at the end.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error("Run with: node --env-file=.env.local --test tests/vault.test.mjs");
}

const db = createClient(url, key, {
  db: { schema: "awesome" },
  auth: { persistSession: false, autoRefreshToken: false },
});

const ORG = randomUUID();
const LOAN = randomUUID();
let planId;
const weekIds = [];

async function ok(promise, what) {
  const { data, error } = await promise;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

/** The two balances, worked out the way the app works them out. */
async function balances() {
  const weeks = await ok(
    db
      .from("savings_weeks")
      .select("saved_amount")
      .eq("org_id", ORG)
      .not("closed_at", "is", null),
    "read weeks",
  );
  const movements = await ok(
    db
      .from("vault_movements")
      .select("kind, vault, amount, amount_cop")
      .eq("org_id", ORG),
    "read movements",
  );
  // A loan paid out of the vault is a loan payment that says which vault paid,
  // not a movement of its own. The balance has to count it.
  const loanPayments = await ok(
    db
      .from("loan_payments")
      .select("amount, from_vault")
      .eq("org_id", ORG)
      .not("from_vault", "is", null),
    "read loan payments",
  );

  let aus = weeks.reduce((s, w) => s + Number(w.saved_amount ?? 0), 0);
  let col = 0;
  let cop = 0;
  for (const m of movements) {
    const amount = Number(m.amount);
    if (m.kind === "transfer") {
      aus -= amount;
      col += amount;
      cop += Number(m.amount_cop ?? 0);
    } else if (m.kind === "withdrawal") {
      if (m.vault === "col") {
        col -= amount;
        cop -= Number(m.amount_cop ?? 0);
      } else aus -= amount;
    } else if (m.kind === "deposit") {
      if (m.vault === "col") {
        col += amount;
        cop += Number(m.amount_cop ?? 0);
      } else aus += amount;
    }
  }
  for (const p of loanPayments) {
    if (p.from_vault === "col") col -= Number(p.amount);
    else aus -= Number(p.amount);
  }
  return { aus: Math.round(aus * 100) / 100, col: Math.round(col * 100) / 100, cop };
}

before(async () => {
  await ok(
    db.from("orgs").insert({
      id: ORG,
      name: "Vault Test",
      is_demo: true,
      max_invoices: null,
      max_clients: null,
    }),
    "create org",
  );

  const plan = await ok(
    db
      .from("savings_plans")
      .insert({
        org_id: ORG,
        name: "Vault Test Plan",
        weekly_target: 1000,
        horizon_months: 24,
        starts_on: "2026-03-02",
      })
      .select("id")
      .single(),
    "create plan",
  );
  planId = plan.id;

  await ok(
    db.from("loans").insert({
      id: LOAN,
      org_id: ORG,
      name: "Vault Test Loan",
      principal: 1000,
      weekly_payment: 50,
    }),
    "create loan",
  );

  // Two weeks that closed. The first was worth 328 and only 200 of it was
  // confirmed: the gap between the two is the whole reason the vault exists.
  for (const [start, saved] of [
    ["2026-03-02", 200],
    ["2026-03-09", 450],
  ]) {
    const week = await ok(
      db
        .from("savings_weeks")
        .insert({
          org_id: ORG,
          plan_id: planId,
          week_start: start,
          week_end: start.slice(0, 8) + String(Number(start.slice(8)) + 6).padStart(2, "0"),
          rotation_week: 1,
          closed_at: new Date().toISOString(),
          closed_by: "test",
          income_total: 1000,
          expenses_total: 672,
          saved_amount: saved,
          target_amount: 1000,
        })
        .select("id")
        .single(),
      `close week ${start}`,
    );
    weekIds.push(week.id);
  }
});

after(async () => {
  await db.from("orgs").delete().eq("id", ORG);
});

describe("the vault", () => {
  test("what lands in it is what each week confirmed", async () => {
    const { aus, col } = await balances();
    assert.equal(aus, 650, "Vault AUS is the confirmed savings, 200 + 450");
    assert.equal(col, 0);
  });

  test("a transfer moves money to Colombia and keeps the rate of the day", async () => {
    await ok(
      db.from("vault_movements").insert({
        org_id: ORG,
        kind: "transfer",
        vault: "aus",
        amount: 400,
        rate: 2800,
        amount_cop: 1_120_000,
        occurred_on: "2026-03-16",
        note: "Wise",
      }),
      "record transfer",
    );

    const { aus, col, cop } = await balances();
    assert.equal(aus, 250, "what was sent left Vault AUS");
    assert.equal(col, 400, "and arrived in Vault COL");
    assert.equal(cop, 1_120_000, "with the pesos it turned into");
  });

  test("a withdrawal needs a reason, and the database says so", async () => {
    const { error } = await db.from("vault_movements").insert({
      org_id: ORG,
      kind: "withdrawal",
      vault: "aus",
      amount: 50,
      occurred_on: "2026-03-17",
    });
    assert.ok(error, "a withdrawal with no reason was accepted");

    await ok(
      db.from("vault_movements").insert({
        org_id: ORG,
        kind: "withdrawal",
        vault: "aus",
        amount: 50,
        reason: "The car",
        occurred_on: "2026-03-17",
      }),
      "record withdrawal",
    );
    const { aus } = await balances();
    assert.equal(aus, 200, "the withdrawal came out of the saving");
  });

  test("money only ever goes one way into Colombia", async () => {
    const { error } = await db.from("vault_movements").insert({
      org_id: ORG,
      kind: "transfer",
      vault: "col",
      amount: 10,
      occurred_on: "2026-03-18",
    });
    assert.ok(error, "a transfer out of Vault COL was accepted");
  });

  test("correcting an old week corrects the vault, with nothing to keep in step", async () => {
    // The first week really saved 300, not 200. There is no deposit row holding
    // the old figure, so the balance moves by itself.
    await ok(
      db
        .from("savings_weeks")
        .update({ saved_amount: 300 })
        .eq("id", weekIds[0]),
      "correct the week",
    );

    const { aus } = await balances();
    assert.equal(aus, 300, "650 + 100 corrected, minus 400 sent and 50 taken");
  });

  test("reopening a week takes its saving back out of the vault", async () => {
    await ok(
      db
        .from("savings_weeks")
        .update({ closed_at: null, saved_amount: null, income_total: null })
        .eq("id", weekIds[1]),
      "reopen the week",
    );

    const { aus } = await balances();
    assert.equal(aus, -150, "the 450 it had confirmed is no longer saved");
  });

  test("a loan paid out of a vault comes out of that vault, once", async () => {
    // Back to a known state: the reopened week is closed again.
    await ok(
      db
        .from("savings_weeks")
        .update({
          closed_at: new Date().toISOString(),
          saved_amount: 450,
          income_total: 1000,
        })
        .eq("id", weekIds[1]),
      "close the week again",
    );
    const before = await balances();
    assert.equal(before.aus, 300);

    await ok(
      db.from("loan_payments").insert({
        org_id: ORG,
        loan_id: LOAN,
        amount: 100,
        from_vault: "aus",
        paid_on: "2026-03-20",
      }),
      "pay the loan from the vault",
    );

    const after = await balances();
    assert.equal(after.aus, 200, "the payment left Vault AUS");

    // And the loan went down by the same 100, from the same row: there is no
    // second record, which is the whole point.
    const payments = await ok(
      db.from("loan_payments").select("amount, from_vault").eq("loan_id", LOAN),
      "read the loan's payments",
    );
    assert.equal(payments.length, 1);
    assert.equal(Number(payments[0].amount), 100);
    const movements = await ok(
      db.from("vault_movements").select("id").eq("org_id", ORG),
      "read movements",
    );
    assert.equal(movements.length, 2, "no movement was created for the payment");
  });

  test("a payment that did not come from the vault leaves it alone", async () => {
    const before = await balances();
    await ok(
      db.from("loan_payments").insert({
        org_id: ORG,
        loan_id: LOAN,
        amount: 50,
        from_vault: null,
        paid_on: "2026-03-21",
      }),
      "pay the loan from the week's money",
    );
    const after = await balances();
    assert.equal(after.aus, before.aus, "the vault moved for a payment it did not fund");
  });

  test("the vault is not a vault for money it does not hold", async () => {
    const { error } = await db.from("loan_payments").insert({
      org_id: ORG,
      loan_id: LOAN,
      amount: 10,
      from_vault: "nowhere",
      paid_on: "2026-03-22",
    });
    assert.ok(error, "a payment named a vault that does not exist");
  });

  test("the bin holds a deleted plan, and the purge empties it after 30 days", async () => {
    const payload = { plan: { id: LOAN }, weeks: [], entries: [], expenses: [] };

    // One deleted a moment ago, one deleted six weeks ago.
    await ok(
      db.from("deleted_plans").insert([
        {
          org_id: ORG,
          plan_id: planId,
          name: "Fresh",
          starts_on: "2026-03-02",
          ends_on: "2026-03-29",
          weeks: 4,
          saved: 800,
          // Both rows name the day: a bulk insert unifies its columns, so a key
          // left off one row arrives as an explicit null rather than a default.
          deleted_at: new Date().toISOString(),
          payload,
        },
        {
          org_id: ORG,
          plan_id: LOAN,
          name: "Stale",
          starts_on: "2026-01-05",
          ends_on: "2026-02-01",
          weeks: 4,
          saved: 500,
          deleted_at: new Date(Date.now() - 42 * 86_400_000).toISOString(),
          payload,
        },
      ]),
      "fill the bin",
    );

    const { data: removed, error } = await db.rpc("purge_deleted_plans", {
      p_days: 30,
    });
    if (error) throw new Error(`purge: ${error.message}`);
    assert.ok(removed >= 1, "the purge removed nothing");

    const left = await ok(
      db.from("deleted_plans").select("name").eq("org_id", ORG),
      "read the bin",
    );
    assert.deepEqual(
      left.map((r) => r.name),
      ["Fresh"],
      "the purge kept the wrong rows",
    );
  });

  test("nothing is left behind when the business goes", async () => {
    await ok(db.from("orgs").delete().eq("id", ORG), "delete org");
    const left = await ok(
      db.from("vault_movements").select("id").eq("org_id", ORG),
      "read movements",
    );
    assert.equal(left.length, 0, "vault movements outlived their business");

    const binned = await ok(
      db.from("deleted_plans").select("id").eq("org_id", ORG),
      "read the bin",
    );
    assert.equal(binned.length, 0, "the plan bin outlived its business");
  });
});
