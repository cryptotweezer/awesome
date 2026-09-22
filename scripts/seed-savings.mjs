// Fill the savings plan with a year of invented history, so the screens can be
// judged against something that looks like a real business instead of an empty
// state.
//
//   node --env-file=.env.local scripts/seed-savings.mjs
//   node --env-file=.env.local scripts/seed-savings.mjs --cleanup
//
// What it builds, for Awesome and nobody else:
//
//   * a plan of 1000 a week over 25 months, started 14 months ago
//   * every week from then until today, pre-filled from the rotation
//   * the weeks up to four weeks ago CLOSED, with a realistic spread: most
//     around the target, some well over, some under, a few badly under
//   * the last four weeks left open and pending, the way they really would be
//   * expense overrides and unexpected costs scattered through, because a year
//     where nothing went wrong would prove nothing
//
// It touches no invoice and no client: it reads the rotation as it stands and
// records what those weeks would have looked like. --cleanup removes every week
// it made and clears the plan's start date, leaving clients, expenses and loans
// exactly as they were.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Run with: node --env-file=.env.local scripts/seed-savings.mjs");
  process.exit(1);
}

const db = createClient(url, key, {
  db: { schema: "awesome" },
  auth: { persistSession: false, autoRefreshToken: false },
});

const ORG = "00000000-0000-0000-0000-000000000001";
const cleanup = process.argv.includes("--cleanup");

// -- dates ------------------------------------------------------------------

const addDays = (date, days) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
};

const todayInSydney = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

// A fixed sequence, so two runs produce the same history and a screenshot from
// yesterday still matches what is on screen today.
function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// -- cleanup ----------------------------------------------------------------

if (cleanup) {
  // Deleting the plans takes their weeks by cascade, and the weeks take their
  // lines and costs the same way.
  const { error: planError } = await db
    .from("savings_plans")
    .delete()
    .eq("org_id", ORG);
  if (planError) throw new Error(planError.message);
  console.log("Removed every savings plan, and every week under them.");
  process.exit(0);
}

// -- what the rotation says -------------------------------------------------

const today = todayInSydney();

const { data: clientRows, error: clientError } = await db
  .from("clients")
  .select("*")
  .eq("org_id", ORG)
  .eq("is_active", true);
if (clientError) throw new Error(clientError.message);

const clients = clientRows ?? [];
const inWeek = (c, n) => (n === 1 ? c.in_week_1 : c.in_week_2);
const dayOf = (c, n) => (n === 1 ? c.week_1_day : c.week_2_day);
const seqOf = (c, n) => (n === 1 ? c.week_1_seq : c.week_2_seq) ?? 999;

// A history built from three clients would prove nothing, so anybody weekly or
// fortnightly who has not been placed yet is spread across the two weeks. What
// was placed by hand is left exactly where it was put: this fills gaps, it does
// not rearrange somebody's route.
//
// The other cadences stay off the rotation on purpose. A monthly client does
// not fit a two-week grid, and inventing a slot for one would be a lie the
// screens would then repeat back.
const unplaced = clients.filter(
  (c) =>
    !c.in_week_1 &&
    !c.in_week_2 &&
    (c.cadence === "weekly" || c.cadence === "fortnightly"),
);

if (unplaced.length > 0) {
  const spread = [];
  unplaced.forEach((c, i) => {
    const day = (i % 6) + 1; // Monday to Saturday
    const seq = Math.floor(i / 6) + 1;
    const weekly = c.cadence === "weekly";
    const side = i % 2 === 0 ? 1 : 2;
    spread.push({
      id: c.id,
      in_week_1: weekly || side === 1,
      in_week_2: weekly || side === 2,
      week_1_day: weekly || side === 1 ? day : null,
      week_2_day: weekly || side === 2 ? day : null,
      week_1_seq: weekly || side === 1 ? seq : null,
      week_2_seq: weekly || side === 2 ? seq : null,
    });
  });

  for (const row of spread) {
    const { id, ...patch } = row;
    const { error } = await db
      .from("clients")
      .update(patch)
      .eq("org_id", ORG)
      .eq("id", id);
    if (error) throw new Error(error.message);
    Object.assign(
      clients.find((c) => c.id === id),
      patch,
    );
  }
  console.log(`Placed ${spread.length} clients onto the rotation.`);
}

const placed = clients.filter((c) => c.in_week_1 || c.in_week_2);
if (placed.length === 0) {
  console.error(
    "Nobody is on the rotation, so there is nothing to invent a week from.\n" +
      "Put some clients into week 1 and week 2 first, at /savings/rotation.",
  );
  process.exit(1);
}

const { data: expenseRows, error: expenseError } = await db
  .from("expense_items")
  .select("*")
  .eq("org_id", ORG)
  .eq("is_active", true);
if (expenseError) throw new Error(expenseError.message);
const expenses = expenseRows ?? [];
const standingTotal = expenses.reduce(
  (sum, e) => sum + Number(e.weekly_amount),
  0,
);

// -- the plan ---------------------------------------------------------------

const WEEKS_BACK = 61; // a little over 14 months
const OPEN_WEEKS = 4; // the ones left unclosed, the way they really are
const WEEKLY_TARGET = 1000;

// Start on the same weekday as today, 61 weeks ago.
const startsOn = addDays(today, -WEEKS_BACK * 7);

// Start from a clean slate so running this twice does not stack two histories.
// The plans go first and take their weeks with them.
await db.from("savings_plans").delete().eq("org_id", ORG);

const { data: plan, error: planError } = await db
  .from("savings_plans")
  .insert({
    org_id: ORG,
    name: "Seeded plan",
    weekly_target: WEEKLY_TARGET,
    horizon_months: 25,
    starts_on: startsOn,
    notes: "Seeded history for testing.",
  })
  .select("id")
  .single();
if (planError) throw new Error(planError.message);

// -- the weeks --------------------------------------------------------------

const random = rng(20260920);
const weeksToBuild = WEEKS_BACK + 1;
const weekRows = [];
for (let i = 1; i <= weeksToBuild; i++) {
  const start = addDays(startsOn, (i - 1) * 7);
  if (start > today) break;
  weekRows.push({
    org_id: ORG,
    plan_id: plan.id,
    week_start: start,
    week_end: addDays(start, 6),
    rotation_week: i % 2 === 1 ? 1 : 2,
  });
}

const { data: inserted, error: weekError } = await db
  .from("savings_weeks")
  .insert(weekRows)
  .select("*");
if (weekError) throw new Error(weekError.message);

const weeks = (inserted ?? []).sort((a, b) =>
  a.week_start.localeCompare(b.week_start),
);
const lastClosedIndex = weeks.length - OPEN_WEEKS;

const entries = [];
const weekExpenses = [];
const updates = [];

const UNEXPECTED = [
  ["Car repair", 420, "australia"],
  ["Vacuum motor", 260, "australia"],
  ["Dentist", 340, "australia"],
  ["Flight change", 610, "colombia"],
  ["Visa documents", 180, "visa"],
  ["New pressure washer", 520, "australia"],
  ["Tyres", 480, "australia"],
];

weeks.forEach((week, index) => {
  const n = week.rotation_week;
  const due = placed
    .filter((c) => inWeek(c, n))
    .sort((a, b) => seqOf(a, n) - seqOf(b, n));

  const closing = index < lastClosedIndex;
  let income = 0;

  due.forEach((c, position) => {
    const rate = Number(c.default_rate ?? 0);
    const roll = random();

    // Roughly one job in fourteen does not happen: somebody cancels, somebody
    // is away. A year with none of that would prove nothing.
    const skipped = roll < 0.07;
    // And now and again there is extra work on top of the usual job.
    const extra = !skipped && roll > 0.93 ? Math.round(rate * 0.4) : 0;
    // A day here and there moves.
    const moved = !skipped && roll > 0.88;

    const cash = c.billing_type === "cash";
    // Invoiced clients pay late, which is the whole reason weeks stay open.
    const paid = skipped ? false : cash ? true : closing ? random() > 0.08 : random() > 0.5;

    const day = dayOf(c, n);
    entries.push({
      org_id: ORG,
      week_id: week.id,
      client_id: c.id,
      client_name: c.name,
      source: "rotation",
      status: skipped ? "skipped" : "done",
      day: moved && day ? ((day % 6) + 1) : day,
      amount: rate,
      extra_amount: extra,
      extra_note: extra > 0 ? "Windows and balcony" : null,
      method: cash ? "cash" : "account",
      paid,
      paid_on: paid ? addDays(week.week_start, Math.min(6, position % 6)) : null,
      note: skipped ? "Cancelled" : null,
      sort_order: seqOf(c, n),
    });

    if (!skipped) income += rate + extra;
  });

  let weekExpenseTotal = standingTotal;

  // A standing cost that came in higher, now and then.
  if (expenses.length > 0 && random() > 0.7) {
    const item = expenses[Math.floor(random() * expenses.length)];
    const normal = Number(item.weekly_amount);
    const actual = Math.round(normal * (1.15 + random() * 0.5));
    weekExpenses.push({
      org_id: ORG,
      week_id: week.id,
      expense_item_id: item.id,
      name: item.name,
      category: item.category,
      amount: actual,
      kind: "override",
      note: "Came in higher",
    });
    weekExpenseTotal += actual - normal;
  }

  // Shape the outcome on purpose.
  //
  // This is invented data and its job is to put every state on screen. Left
  // entirely to chance, a year of one business is one long flat line slightly
  // under target, which shows nothing about how a good week, a level week or a
  // bad one actually look. So each week is given an outcome to land on, and the
  // gap is made up the way it would be in real life: a job that came out of
  // nowhere, or a cost that did.
  const outcome = random();
  const desired =
    outcome < 0.34
      ? WEEKLY_TARGET + Math.round(random() * 850) // a good week
      : outcome < 0.48
        ? WEEKLY_TARGET + Math.round((random() - 0.5) * 30) // level
        : outcome < 0.86
          ? Math.round(random() * WEEKLY_TARGET) // short
          : -Math.round(random() * 650); // a bad one

  const gap = Math.round(desired - (income - weekExpenseTotal));

  if (gap > 0) {
    const amount = gap;
    entries.push({
      org_id: ORG,
      week_id: week.id,
      client_id: null,
      client_name: ["End of lease clean", "Office one-off", "Airbnb turnover"][
        Math.floor(random() * 3)
      ],
      source: "oneoff",
      status: "done",
      day: 6,
      amount,
      // Every row in a batch insert has to carry the same keys: Supabase unions
      // them and sends an explicit null for any a row leaves out, which a not
      // null column then refuses.
      extra_amount: 0,
      extra_note: null,
      method: "cash",
      paid: true,
      paid_on: addDays(week.week_start, 5),
      note: null,
      sort_order: 950,
    });
    income += amount;
  } else if (gap < 0) {
    // The week fell short because something happened to it.
    const [name, , category] = UNEXPECTED[Math.floor(random() * UNEXPECTED.length)];
    const amount = -gap;
    weekExpenses.push({
      org_id: ORG,
      week_id: week.id,
      expense_item_id: null,
      name,
      category,
      amount,
      kind: "oneoff",
      note: null,
    });
    weekExpenseTotal += amount;
  }

  if (closing) {
    const saved = income - weekExpenseTotal;
    updates.push({
      id: week.id,
      closed_at: new Date(`${week.week_end}T09:00:00Z`).toISOString(),
      closed_by: index % 3 === 0 ? "Mavi" : "Andres",
      income_total: income,
      expenses_total: weekExpenseTotal,
      saved_amount: saved,
      target_amount: WEEKLY_TARGET,
    });
  }
});

// Insert in batches: a year of a real rotation is a few thousand rows.
async function insertAll(table, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from(table).insert(rows.slice(i, i + 500));
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

await insertAll("week_entries", entries);
await insertAll("week_expenses", weekExpenses);

for (const u of updates) {
  const { id, ...patch } = u;
  const { error } = await db
    .from("savings_weeks")
    .update(patch)
    .eq("org_id", ORG)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// -- what it came to --------------------------------------------------------

const closed = updates.map((u) => Number(u.saved_amount));
const total = closed.reduce((s, v) => s + v, 0);
const over = closed.filter((v) => v > WEEKLY_TARGET + 20).length;
const level = closed.filter((v) => Math.abs(v - WEEKLY_TARGET) <= 20).length;
const short = closed.filter((v) => v < WEEKLY_TARGET - 20 && v >= 0).length;
const negative = closed.filter((v) => v < 0).length;

console.log(`Plan starts ${startsOn}, ${WEEKLY_TARGET} a week over 25 months.`);
console.log(
  `${weeks.length} weeks built, ${updates.length} closed, ${OPEN_WEEKS} left open.`,
);
console.log(`${entries.length} lines of work, ${weekExpenses.length} cost changes.`);
console.log(
  `Closed weeks: ${over} over target, ${level} level, ${short} short, ` +
    `${negative} in the red.`,
);
console.log(
  `Best ${Math.max(...closed).toFixed(2)}, worst ${Math.min(...closed).toFixed(2)}, ` +
    `saved in total AUD ${total.toFixed(2)}.`,
);
console.log("Undo with: node --env-file=.env.local scripts/seed-savings.mjs --cleanup");
