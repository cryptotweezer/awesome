import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayInSydney } from "@/lib/format";
import { isLongerCycle, methodFor, nextDueOn } from "@/lib/savings";
import { currentPlan, getPlan, weeksOf } from "@/lib/data/savings-plan";
import type {
  ClientWithIssuer,
  CloseBlocker,
  ExpenseItem,
  SavingsWeek,
  WeekDetail,
  WeekEntry,
  WeekExpense,
  WeekState,
} from "@/lib/types";

/**
 * The weeks that actually happened.
 *
 * A week is born pre-filled from the rotation and reality is applied on top. It
 * is never generated twice: `ensureWeeks` creates the rows that are missing
 * between the plan's start and today, and `syncWeek` keeps an open week in step
 * with the rotation and with the invoiced work that belongs to it.
 *
 * **What ties the two halves of the app together is the service date**, the day
 * the work was done, which each invoice line carries. Not the invoice's own
 * date: an invoice is raised on the Friday, or at the end of the month, for
 * work done on the Tuesday, and keying off the document's date left that week
 * looking as if nothing had been billed. Each invoice LINE lands in the week
 * its service date falls in, so one monthly invoice feeds its four weeks and
 * each week counts only its own lines.
 *
 * Nothing here touches a closed week. A closed week holds its own figures and
 * is only changed by reopening it, on purpose.
 */

const num = (v: unknown) => Number(v ?? 0);

// -- dates ------------------------------------------------------------------

/** Plain calendar arithmetic on a YYYY-MM-DD string, with no timezone in it. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const [ay, am, ad] = from.split("-").map(Number);
  const [by, bm, bd] = to.split("-").map(Number);
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000,
  );
}

/**
 * The date a line sits on: its own day, or the end of the week if it has none.
 *
 * A line with no day still belongs to the week, so it is treated as happening
 * by the time the week is over rather than never.
 */
export function dateOfEntry(week: SavingsWeek, day: number | null): string {
  if (day === null) return week.week_end;
  for (let i = 0; i < 7; i++) {
    const at = addDays(week.week_start, i);
    if (isoWeekday(at) === day) return at;
  }
  return week.week_end;
}

/** ISO weekday of a plain date: Monday is 1, Sunday is 7, same as `day`. */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/** Which week of the plan a date falls in, counting from 1. 0 means before it. */
export function weekIndexFor(startsOn: string, date: string): number {
  const days = daysBetween(startsOn, date);
  if (days < 0) return 0;
  return Math.floor(days / 7) + 1;
}

/** A week belongs to the month it STARTS in, which is the user's rule. */
export function monthOf(weekStart: string): string {
  return weekStart.slice(0, 7);
}

/**
 * Open, pending or closed.
 *
 * Pending is the honest name for a week that has ended and is not settled:
 * usually money still to arrive. It is derived from the date so it can never go
 * stale.
 */
export function stateOf(week: SavingsWeek, today = todayInSydney()): WeekState {
  if (week.closed_at) return "closed";
  return week.week_end < today ? "pending" : "open";
}

// -- reading ----------------------------------------------------------------

function normaliseWeek(row: Record<string, unknown>): SavingsWeek {
  return {
    ...(row as unknown as SavingsWeek),
    income_total: row.income_total === null ? null : num(row.income_total),
    expenses_total:
      row.expenses_total === null ? null : num(row.expenses_total),
    saved_amount: row.saved_amount === null ? null : num(row.saved_amount),
    target_amount: row.target_amount === null ? null : num(row.target_amount),
  };
}

/**
 * The invoice a line points at, flattened onto the line.
 *
 * The number and the paid state are READ from the invoice on every load rather
 * than copied into `week_entries`. Marking an invoice paid anywhere, on the
 * invoice page or by an agent, therefore shows up on its week with nothing to
 * keep in step.
 */
function normaliseEntry(row: Record<string, unknown>): WeekEntry {
  const invoice = row.invoice as
    | { invoice_number: number; status: string; invoice_date: string }
    | null
    | undefined;
  const rest = { ...row };
  delete rest.invoice;
  return {
    ...(rest as unknown as WeekEntry),
    amount: num(row.amount),
    extra_amount: num(row.extra_amount),
    invoice_number: invoice?.invoice_number ?? null,
    invoice_status: (invoice?.status as WeekEntry["invoice_status"]) ?? null,
    invoice_date: invoice?.invoice_date ?? null,
  };
}

/** Every line, with the invoice behind it. One query, not one per line. */
const ENTRY_SELECT =
  "*, invoice:invoices(invoice_number, status, invoice_date)";

function normaliseExpense(row: Record<string, unknown>): WeekExpense {
  return { ...(row as unknown as WeekExpense), amount: num(row.amount) };
}

export async function listWeeks(
  orgId: string,
  opts: { from?: string; to?: string; openOnly?: boolean; limit?: number } = {},
): Promise<SavingsWeek[]> {
  const supabase = createAdminClient();
  let query = supabase
    .from("savings_weeks")
    .select("*")
    .eq("org_id", orgId);
  if (opts.from) query = query.gte("week_start", opts.from);
  if (opts.to) query = query.lte("week_start", opts.to);
  if (opts.openOnly) query = query.is("closed_at", null);
  query = query.order("week_start", { ascending: false });
  if (opts.limit) query = query.limit(opts.limit);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to load weeks: ${error.message}`);
  return (data ?? []).map(normaliseWeek);
}

export async function getWeek(
  orgId: string,
  id: string,
): Promise<SavingsWeek | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("savings_weeks")
    .select("*")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load the week: ${error.message}`);
  return data ? normaliseWeek(data) : null;
}

/**
 * Every line and every recorded cost of several weeks, in two queries.
 *
 * A list of a year's weeks asking each one for its own rows is a hundred and
 * twenty round trips to render one page. The tables are small and belong to one
 * business, so they are fetched whole and grouped here.
 */
export async function entriesAndExpensesFor(
  orgId: string,
  weekIds: string[],
): Promise<{
  entries: Map<string, WeekEntry[]>;
  expenses: Map<string, WeekExpense[]>;
}> {
  const entries = new Map<string, WeekEntry[]>();
  const expenses = new Map<string, WeekExpense[]>();
  if (weekIds.length === 0) return { entries, expenses };

  const supabase = createAdminClient();
  const [entryRows, expenseRows] = await Promise.all([
    supabase
      .from("week_entries")
      .select(ENTRY_SELECT)
      .eq("org_id", orgId)
      .in("week_id", weekIds)
      .order("sort_order")
      .order("client_name"),
    supabase
      .from("week_expenses")
      .select("*")
      .eq("org_id", orgId)
      .in("week_id", weekIds)
      .order("name"),
  ]);
  if (entryRows.error) {
    throw new Error(`Failed to load the weeks: ${entryRows.error.message}`);
  }
  if (expenseRows.error) {
    throw new Error(`Failed to load the weeks: ${expenseRows.error.message}`);
  }

  for (const row of entryRows.data ?? []) {
    const e = normaliseEntry(row);
    entries.set(e.week_id, [...(entries.get(e.week_id) ?? []), e]);
  }
  for (const row of expenseRows.data ?? []) {
    const x = normaliseExpense(row);
    expenses.set(x.week_id, [...(expenses.get(x.week_id) ?? []), x]);
  }
  return { entries, expenses };
}

export async function listEntries(
  orgId: string,
  weekId: string,
): Promise<WeekEntry[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("week_entries")
    .select(ENTRY_SELECT)
    .eq("org_id", orgId)
    .eq("week_id", weekId)
    .order("sort_order")
    .order("client_name");
  if (error) throw new Error(`Failed to load the week: ${error.message}`);
  return (data ?? []).map(normaliseEntry);
}

/**
 * The last day each client's work was actually done, across every week.
 *
 * One query for the whole business rather than one per client: the table is
 * small, belongs to one business, and this is asked for every week on screen.
 * Only `done` counts, which is what makes a cancelled visit push a monthly
 * client's next date along instead of letting the chain run on a service that
 * never happened.
 */
export async function lastServiceDates(
  orgId: string,
): Promise<Map<string, string>> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("week_entries")
    .select("client_id, day, week:savings_weeks(week_start, week_end)")
    .eq("org_id", orgId)
    .eq("status", "done")
    .not("client_id", "is", null);
  if (error) {
    throw new Error(`Failed to read the service history: ${error.message}`);
  }

  const latest = new Map<string, string>();
  for (const row of (data ?? []) as unknown as {
    client_id: string;
    day: number | null;
    week: { week_start: string; week_end: string } | null;
  }[]) {
    if (!row.week) continue;
    const on = dateOfEntry(
      {
        week_start: row.week.week_start,
        week_end: row.week.week_end,
      } as SavingsWeek,
      row.day,
    );
    const held = latest.get(row.client_id);
    if (!held || on > held) latest.set(row.client_id, on);
  }
  return latest;
}

/** One line, for a caller that has its id and needs to check it. */
export async function getEntry(
  orgId: string,
  id: string,
): Promise<WeekEntry | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("week_entries")
    .select(ENTRY_SELECT)
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load the line: ${error.message}`);
  return data ? normaliseEntry(data) : null;
}

export async function listWeekExpenses(
  orgId: string,
  weekId: string,
): Promise<WeekExpense[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("week_expenses")
    .select("*")
    .eq("org_id", orgId)
    .eq("week_id", weekId)
    .order("name");
  if (error) throw new Error(`Failed to load the week: ${error.message}`);
  return (data ?? []).map(normaliseExpense);
}

// -- the figures ------------------------------------------------------------

/**
 * What a week comes to.
 *
 * An open week is worked out live: the standing expenses as they are today,
 * overridden where this week was different. A closed week reads the figures it
 * froze, so raising a rate or a fixed cost tomorrow cannot rewrite it.
 */
export function figuresFor(
  week: SavingsWeek,
  entries: WeekEntry[],
  weekExpenses: WeekExpense[],
  standing: ExpenseItem[],
  weeklyTarget: number,
): Omit<WeekDetail, "week" | "state" | "entries" | "expenses" | "blockers"> {
  const counted = entries.filter((e) => e.status === "done");
  const income = counted.reduce((s, e) => s + e.amount + e.extra_amount, 0);
  const received = counted
    .filter((e) => e.paid)
    .reduce((s, e) => s + e.amount + e.extra_amount, 0);

  // What the week is worth if it goes the way it is meant to: every job that
  // has not been cancelled, whether or not its day has come round yet. This is
  // the figure a week is judged on while it is running, because on Monday
  // nothing has happened yet and `income` would say the week is a disaster.
  const expected = entries
    .filter((e) => e.status !== "skipped")
    .reduce((s, e) => s + e.amount + e.extra_amount, 0);

  let expensesTotal: number;
  let target: number;

  if (week.closed_at) {
    expensesTotal = week.expenses_total ?? 0;
    target = week.target_amount ?? weeklyTarget;
  } else {
    const overrides = new Map(
      weekExpenses
        .filter((x) => x.kind === "override" && x.expense_item_id)
        .map((x) => [x.expense_item_id as string, x.amount]),
    );
    const standingTotal = standing
      .filter((i) => i.is_active)
      .reduce((s, i) => s + (overrides.get(i.id) ?? i.weekly_amount), 0);
    const oneOffs = weekExpenses
      .filter((x) => x.kind === "oneoff")
      .reduce((s, x) => s + x.amount, 0);
    expensesTotal = standingTotal + oneOffs;
    target = weeklyTarget;
  }

  const saved = week.closed_at
    ? (week.saved_amount ?? 0)
    : income - expensesTotal;

  const expectedIncome = week.closed_at
    ? (week.income_total ?? income)
    : expected;

  return {
    income: week.closed_at ? (week.income_total ?? income) : income,
    expected_income: expectedIncome,
    received,
    outstanding: income - received,
    expenses_total: expensesTotal,
    saved,
    // A closed week has nothing left to expect, so its surplus IS what it
    // saved. An open one is read forwards.
    surplus: week.closed_at ? saved : expectedIncome - expensesTotal,
    target,
    against_target: saved - target,
  };
}

/** The full picture of one week, ready to render. */
export async function getWeekDetail(
  orgId: string,
  weekId: string,
): Promise<WeekDetail | null> {
  const week = await getWeek(orgId, weekId);
  if (!week) return null;

  const supabase = createAdminClient();
  const [entries, expenses, plan, standing] = await Promise.all([
    listEntries(orgId, weekId),
    listWeekExpenses(orgId, weekId),
    // The week's OWN plan, not whichever one is running: a week of a finished
    // plan is read against the target it was run under.
    getPlan(orgId, week.plan_id),
    supabase
      .from("expense_items")
      .select("*")
      .eq("org_id", orgId)
      .then(({ data }) =>
        (data ?? []).map((r) => ({
          ...r,
          weekly_amount: num(r.weekly_amount),
        })) as ExpenseItem[],
      ),
  ]);

  return {
    week,
    state: stateOf(week),
    entries,
    expenses,
    blockers: closeBlockers(entries),
    ...figuresFor(week, entries, expenses, standing, plan?.weekly_target ?? 0),
  };
}

// -- creating and syncing ---------------------------------------------------

/**
 * Make sure every week of the running plan, up to today, exists.
 *
 * Idempotent: it only inserts the ones that are missing, so it can run on every
 * page load without doing anything the second time. Between plans there is
 * nothing to open, and the weeks of plans already finished are left exactly as
 * they were: this never reaches back past the plan it is working on.
 *
 * It returns every week the business has, not only the running plan's, because
 * a week stays open until its money arrives and those belong on screen long
 * after the plan they were run under has ended.
 */
export async function ensureWeeks(
  orgId: string,
  today = todayInSydney(),
): Promise<SavingsWeek[]> {
  const plan = await currentPlan(orgId, today);
  if (!plan) return listWeeks(orgId);

  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from("savings_weeks")
    .select("week_start")
    .eq("org_id", orgId);
  const have = new Set((existing ?? []).map((r) => r.week_start as string));

  // Never past the plan's own horizon: the last week of a plan is its last
  // week, and the days after it belong to whatever comes next.
  const lastIndex = Math.min(
    weekIndexFor(plan.starts_on, today),
    weeksOf(plan),
  );
  const missing: Record<string, unknown>[] = [];
  for (let i = 1; i <= lastIndex; i++) {
    const start = addDays(plan.starts_on, (i - 1) * 7);
    if (have.has(start)) continue;
    missing.push({
      org_id: orgId,
      plan_id: plan.id,
      week_start: start,
      week_end: addDays(start, 6),
      // The rotation alternates from the plan's first week.
      rotation_week: i % 2 === 1 ? 1 : 2,
    });
  }

  if (missing.length > 0) {
    const { error } = await supabase.from("savings_weeks").insert(missing);
    if (error) throw new Error(`Failed to open the weeks: ${error.message}`);
  }

  return listWeeks(orgId);
}

/**
 * Bring one open week into step with the rotation and with billing.
 *
 * Three things happen:
 *
 *   1. every client the rotation says is due gets a line, if they have none;
 *   2. every piece of invoiced work whose SERVICE DATE falls inside this week
 *      is put on the week: onto the client's rotation line where there is one,
 *      as a new line where the rotation never expected them;
 *   3. a line that follows an invoice takes its amount, its day and its
 *      payment from that invoice, so a payment is recorded once, on the
 *      invoice, and only read here. A line whose invoice no longer covers this
 *      week (cancelled, deleted, or its service date moved) is unlinked and
 *      goes back to being work waiting to be invoiced, rather than quietly
 *      keeping a number that is no longer true;
 *   3b. a client on a longer cycle (monthly, every N weeks) is placed in the
 *      week their next date falls in, counted from the last time their work was
 *      really done. The two-week rotation cannot hold these, and before this
 *      they existed nowhere until somebody remembered them;
 *   4. a line whose day has passed with nobody saying otherwise is recorded as
 *      done. The work is regular: the same clients on the same days, week after
 *      week, and it happens unless something stops it. Asking for a click on
 *      each of thirty jobs to say the ordinary thing happened is asking for the
 *      week to be wrong by Wednesday. What needs saying is the exception, and
 *      that is what the buttons on a line are for.
 *
 * A closed week is left alone.
 */
export async function syncWeek(
  orgId: string,
  weekId: string,
  today = todayInSydney(),
): Promise<void> {
  const week = await getWeek(orgId, weekId);
  if (!week || week.closed_at) return;

  const supabase = createAdminClient();

  const [{ data: clientRows }, entries, billed, lastDone] = await Promise.all([
    supabase.from("clients").select("*").eq("org_id", orgId).eq("is_active", true),
    listEntries(orgId, weekId),
    billedWorkIn(orgId, week),
    lastServiceDates(orgId),
  ]);

  const clients = (clientRows ?? []) as unknown as ClientWithIssuer[];
  const byClient = new Map(entries.map((e) => [e.client_id, e]));
  // Keyed by client so the rotation and the invoices cannot each insert a line
  // for the same person: one line per client per week is a constraint.
  const inserts = new Map<string, Record<string, unknown>>();

  // 1. The rotation's clients.
  const due = clients.filter((c) =>
    week.rotation_week === 1 ? c.in_week_1 : c.in_week_2,
  );
  for (const c of due) {
    if (byClient.has(c.id)) continue;
    inserts.set(c.id, {
      org_id: orgId,
      week_id: weekId,
      client_id: c.id,
      client_name: c.name,
      source: "rotation",
      status: "expected",
      day: week.rotation_week === 1 ? c.week_1_day : c.week_2_day,
      amount: c.default_rate ?? 0,
      method: methodFor(c.billing_type),
      sort_order:
        (week.rotation_week === 1 ? c.week_1_seq : c.week_2_seq) ?? 999,
    });
  }


  // 1b. Clients on a longer cycle than the rotation can hold.
  for (const c of clients) {
    if (!isLongerCycle(c)) continue;
    if (byClient.has(c.id) || inserts.has(c.id)) continue;
    const last = lastDone.get(c.id);
    // Nothing to count from until the first service is recorded. Adding it to
    // a week by hand, or through an invoice, is what starts the chain.
    if (!last) continue;
    const due = nextDueOn(c, last);
    // Placed in the week the date falls in and nowhere else. A date that has
    // gone by without the work being done leaves the client off every later
    // week on purpose, rather than being pasted into each one; the Rotation
    // page is where that shows, as overdue.
    if (!due || due < week.week_start || due > week.week_end) continue;
    inserts.set(c.id, {
      org_id: orgId,
      week_id: weekId,
      client_id: c.id,
      client_name: c.name,
      source: "rotation",
      status: "expected",
      day: isoWeekday(due),
      amount: c.default_rate ?? 0,
      method: methodFor(c.billing_type),
      sort_order: 800,
    });
  }

  // 2. Invoiced work that belongs to this week, on the line it belongs to.
  for (const b of billed.values()) {
    if (byClient.has(b.client_id)) continue; // step 3 updates it in place
    const pencilled = inserts.get(b.client_id);
    const fields = {
      client_name: b.client_name,
      status: "done",
      method: "account",
      amount: b.amount,
      // The invoice carries the extra as a line of its own, so the week must
      // not also hold it: that would count the same money twice.
      extra_amount: 0,
      paid: b.paid,
      paid_on: b.paid_on,
      invoice_id: b.invoice_ids[0],
      ...(b.service_date ? { day: isoWeekday(b.service_date) } : {}),
    };
    if (pencilled) {
      inserts.set(b.client_id, { ...pencilled, ...fields });
      continue;
    }
    inserts.set(b.client_id, {
      org_id: orgId,
      week_id: weekId,
      client_id: b.client_id,
      source: "adhoc",
      sort_order: 900,
      ...fields,
    });
  }

  if (inserts.size > 0) {
    const { error } = await supabase
      .from("week_entries")
      .insert([...inserts.values()]);
    if (error) throw new Error(`Failed to fill the week: ${error.message}`);
  }

  // 3. Lines that already exist follow their invoice, or stop claiming one.
  for (const e of entries) {
    const b = e.client_id ? billed.get(e.client_id) : undefined;

    if (!b) {
      // Nothing of this client's is invoiced into this week any more.
      if (e.invoice_id === null) continue;
      await supabase
        .from("week_entries")
        .update({ invoice_id: null, paid: false, paid_on: null })
        .eq("org_id", orgId)
        .eq("id", e.id);
      continue;
    }

    const invoiceId = b.invoice_ids[0];
    const day = b.service_date ? isoWeekday(b.service_date) : e.day;
    if (
      e.invoice_id === invoiceId &&
      e.paid === b.paid &&
      e.amount === b.amount &&
      e.extra_amount === 0 &&
      e.status === "done" &&
      e.day === day
    ) {
      continue;
    }
    await supabase
      .from("week_entries")
      .update({
        invoice_id: invoiceId,
        amount: b.amount,
        extra_amount: 0,
        status: "done",
        method: "account",
        day,
        paid: b.paid,
        paid_on: b.paid_on,
      })
      .eq("org_id", orgId)
      .eq("id", e.id);
  }

  // 4. Last, because it reads the rows the three passes above have just left.
  await completePastDays(orgId, week, today);
}

/**
 * Every line whose day has gone by and which nobody has ruled on, recorded as
 * done.
 *
 * Only lines still sitting at `expected` are touched, so a decision already
 * made is never overwritten: a job marked cancelled stays cancelled, and one
 * marked done keeps the payment it was given. Strictly past, never today: a
 * Wednesday job has not happened at eight in the morning, and the week's
 * surplus already counts it as expected either way.
 *
 * Cash is settled as the work finishes, so a cash line comes out paid, dated
 * the day it happened. Anything arriving by bank does not: that is the money
 * the week then waits for, and the whole reason a week stays open.
 */
async function completePastDays(
  orgId: string,
  week: SavingsWeek,
  today: string,
): Promise<void> {
  const supabase = createAdminClient();
  const entries = await listEntries(orgId, week.id);

  for (const e of entries) {
    if (e.status !== "expected") continue;
    const on = dateOfEntry(week, e.day);
    if (on >= today) continue;
    await supabase
      .from("week_entries")
      .update({
        status: "done",
        ...(e.method === "cash" && !e.paid ? { paid: true, paid_on: on } : {}),
      })
      .eq("org_id", orgId)
      .eq("id", e.id);
  }
}

/** One client's invoiced work inside one week, however it was billed. */
type BilledWork = {
  /** The invoices touching this week. Normally one; the line follows the first. */
  invoice_ids: string[];
  client_id: string;
  client_name: string;
  /** Only the lines dated inside this week, so a monthly invoice splits itself. */
  amount: number;
  /** The day the work was done, when the invoice says. */
  service_date: string | null;
  paid: boolean;
  paid_on: string | null;
};

/**
 * What was invoiced for work done inside this week, by client.
 *
 * Read in passes because there are two kinds of invoice. The one that says
 * which day each job was done, where every LINE is placed by its own
 * `service_date`, which is the shape the gateway enforces and the dashboard
 * offers. And the older, lazier one whose lines carry no date at all: that
 * invoice can only belong to the week it was raised in, and it is taken whole.
 *
 * An invoice with dated lines is never also read by its own date, so nothing is
 * ever counted twice, and its lines dated in other weeks stay in those weeks.
 *
 * The awkward third case is an invoice that is half dated: two cleans with
 * their days and a "materials" line with none. Those undated lines go to the
 * week holding the invoice's EARLIEST dated line, because the alternative is
 * money on an invoice that belongs to no week at all, which is the quiet kind
 * of wrong.
 */
async function billedWorkIn(
  orgId: string,
  week: SavingsWeek,
): Promise<Map<string, BilledWork>> {
  const supabase = createAdminClient();
  const [dated, raisedHere] = await Promise.all([
    supabase
      .from("invoice_items")
      .select(
        "invoice_id, service_date, amount, invoice:invoices!inner(id, client_id, bill_to_name, status, paid_at)",
      )
      .eq("org_id", orgId)
      .gte("service_date", week.week_start)
      .lte("service_date", week.week_end),
    supabase
      .from("invoices")
      .select(
        "id, client_id, bill_to_name, status, paid_at, total, invoice_items(service_date)",
      )
      .eq("org_id", orgId)
      .gte("invoice_date", week.week_start)
      .lte("invoice_date", week.week_end)
      .neq("status", "cancelled"),
  ]);
  if (dated.error) {
    throw new Error(`Failed to read the invoiced work: ${dated.error.message}`);
  }
  if (raisedHere.error) {
    throw new Error(
      `Failed to read the invoiced work: ${raisedHere.error.message}`,
    );
  }

  const byClient = new Map<string, BilledWork>();
  const add = (
    invoiceId: string,
    clientId: string | null,
    name: string,
    status: string,
    paidAt: string | null,
    amount: number,
    serviceDate: string | null,
  ) => {
    // An invoice with no client cannot be matched to anybody's line.
    if (!clientId || status === "cancelled") return;
    const held = byClient.get(clientId);
    if (!held) {
      byClient.set(clientId, {
        invoice_ids: [invoiceId],
        client_id: clientId,
        client_name: name,
        amount,
        service_date: serviceDate,
        paid: status === "paid",
        paid_on: paidAt ? paidAt.slice(0, 10) : null,
      });
      return;
    }
    held.amount += amount;
    if (!held.invoice_ids.includes(invoiceId)) held.invoice_ids.push(invoiceId);
    // The earliest day in the week is the one the line shows.
    if (
      serviceDate &&
      (!held.service_date || serviceDate < held.service_date)
    ) {
      held.service_date = serviceDate;
    }
    // Two invoices, one paid and one not, leave the week still waiting.
    held.paid = held.paid && status === "paid";
    if (!held.paid) held.paid_on = null;
  };

  type JoinedLine = {
    invoice_id: string;
    service_date: string;
    amount: string | number;
    invoice: {
      id: string;
      client_id: string | null;
      bill_to_name: string;
      status: string;
      paid_at: string | null;
    } | null;
  };
  const datedLines = ((dated.data ?? []) as unknown as JoinedLine[]).filter(
    (row) => row.invoice !== null,
  );
  for (const row of datedLines) {
    const inv = row.invoice!;
    add(
      row.invoice_id,
      inv.client_id,
      inv.bill_to_name,
      inv.status,
      inv.paid_at,
      num(row.amount),
      row.service_date,
    );
  }

  // The undated lines of a half-dated invoice, when this is the week its work
  // starts in.
  const touched = [...new Set(datedLines.map((r) => r.invoice_id))];
  if (touched.length > 0) {
    const { data: siblings, error } = await supabase
      .from("invoice_items")
      .select("invoice_id, service_date, amount")
      .eq("org_id", orgId)
      .in("invoice_id", touched);
    if (error) {
      throw new Error(`Failed to read the invoiced work: ${error.message}`);
    }
    const rows = (siblings ?? []) as unknown as {
      invoice_id: string;
      service_date: string | null;
      amount: string | number;
    }[];
    for (const id of touched) {
      const mine = rows.filter((r) => r.invoice_id === id);
      const undated = mine
        .filter((r) => r.service_date === null)
        .reduce((sum, r) => sum + num(r.amount), 0);
      if (undated === 0) continue;
      const earliest = mine
        .map((r) => r.service_date)
        .filter((d): d is string => d !== null)
        .sort()[0];
      if (!earliest || earliest < week.week_start || earliest > week.week_end) {
        continue;
      }
      const line = datedLines.find((r) => r.invoice_id === id)!;
      const inv = line.invoice!;
      add(
        id,
        inv.client_id,
        inv.bill_to_name,
        inv.status,
        inv.paid_at,
        undated,
        null,
      );
    }
  }

  type UndatedInvoice = {
    id: string;
    client_id: string | null;
    bill_to_name: string;
    status: string;
    paid_at: string | null;
    total: string | number;
    invoice_items: { service_date: string | null }[];
  };
  for (const inv of (raisedHere.data ?? []) as unknown as UndatedInvoice[]) {
    const undated = (inv.invoice_items ?? []).every(
      (i) => i.service_date === null,
    );
    if (!undated) continue;
    add(
      inv.id,
      inv.client_id,
      inv.bill_to_name,
      inv.status,
      inv.paid_at,
      num(inv.total),
      null,
    );
  }

  return byClient;
}

// -- editing a week ---------------------------------------------------------

export type EntryPatch = {
  status?: WeekEntry["status"];
  day?: number | null;
  amount?: number;
  extra_amount?: number;
  extra_note?: string | null;
  method?: WeekEntry["method"];
  paid?: boolean;
  paid_on?: string | null;
  note?: string | null;
};

export async function updateEntry(
  orgId: string,
  id: string,
  patch: EntryPatch,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("week_entries")
    .update(patch)
    .eq("org_id", orgId)
    .eq("id", id);
  if (error) throw new Error(`Failed to update the line: ${error.message}`);
}

export type NewEntry = {
  week_id: string;
  client_id: string | null;
  client_name: string;
  source: WeekEntry["source"];
  amount: number;
  day: number | null;
  method: WeekEntry["method"];
  paid: boolean;
  note: string | null;
};

export async function addEntry(orgId: string, input: NewEntry): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("week_entries").insert({
    ...input,
    org_id: orgId,
    status: "done",
    sort_order: 950,
  });
  if (error) throw new Error(`Failed to add the line: ${error.message}`);
}

export async function deleteEntry(orgId: string, id: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("week_entries")
    .delete()
    .eq("org_id", orgId)
    .eq("id", id);
  if (error) throw new Error(`Failed to remove the line: ${error.message}`);
}

/**
 * Say what a standing expense really cost this week, or add one that happened
 * once. Neither touches the standing list, so no other week moves.
 */
export async function setWeekExpense(
  orgId: string,
  weekId: string,
  input: {
    expense_item_id: string | null;
    name: string;
    category: WeekExpense["category"];
    amount: number;
    kind: WeekExpense["kind"];
    note: string | null;
  },
): Promise<void> {
  const supabase = createAdminClient();

  // An override belongs to the commitment its standing item belongs to, read
  // from the item rather than taken from the caller: nobody is asked which
  // group a changed amount is in, and defaulting it would file a Colombian
  // cost under Australia the first time one cost more.
  let category = input.category;
  if (input.expense_item_id) {
    const { data: item } = await supabase
      .from("expense_items")
      .select("category")
      .eq("org_id", orgId)
      .eq("id", input.expense_item_id)
      .maybeSingle();
    if (item?.category) category = item.category as WeekExpense["category"];
  }

  if (input.expense_item_id) {
    const { data: existing } = await supabase
      .from("week_expenses")
      .select("id")
      .eq("org_id", orgId)
      .eq("week_id", weekId)
      .eq("expense_item_id", input.expense_item_id)
      .maybeSingle();
    if (existing) {
      const { error } = await supabase
        .from("week_expenses")
        .update({ amount: input.amount, note: input.note })
        .eq("org_id", orgId)
        .eq("id", existing.id);
      if (error) throw new Error(`Failed to save: ${error.message}`);
      return;
    }
  }

  const { error } = await supabase
    .from("week_expenses")
    .insert({ ...input, category, org_id: orgId, week_id: weekId });
  if (error) throw new Error(`Failed to save: ${error.message}`);
}

export async function deleteWeekExpense(
  orgId: string,
  id: string,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("week_expenses")
    .delete()
    .eq("org_id", orgId)
    .eq("id", id);
  if (error) throw new Error(`Failed to remove: ${error.message}`);
}

export async function updateWeek(
  orgId: string,
  id: string,
  patch: { notes?: string | null },
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("savings_weeks")
    .update(patch)
    .eq("org_id", orgId)
    .eq("id", id);
  if (error) throw new Error(`Failed to save the week: ${error.message}`);
}

// -- closing and reopening --------------------------------------------------

/**
 * Close a week, freezing what it came to.
 *
 * The full expense list is written onto the week as it stood, so that changing
 * a standing cost tomorrow cannot rewrite what this week spent. `saved` is what
 * the caller confirmed, which is usually the computed figure and sometimes not:
 * a person looking at their bank knows things this table does not.
 */
export async function closeWeek(
  orgId: string,
  weekId: string,
  opts: {
    saved?: number;
    by: string;
    notes?: string | null;
    /** Close it anyway, with the money still out. Asked for explicitly. */
    force?: boolean;
  },
): Promise<void> {
  const detail = await getWeekDetail(orgId, weekId);
  if (!detail) throw new Error("Week not found");
  if (detail.week.closed_at) throw new Error("That week is already closed");

  const blockers = closeBlockers(detail.entries);
  if (blockers.length > 0 && !opts.force) {
    throw new Error(
      `This week cannot close yet: ${describeBlockers(blockers)}. ` +
        "Invoice the work and record the payment, mark the transfer received, " +
        "or mark the line paid in cash. Closing anyway has to be asked for.",
    );
  }

  const supabase = createAdminClient();

  // Snapshot the standing expenses that are not already recorded on the week.
  const { data: standingRows } = await supabase
    .from("expense_items")
    .select("*")
    .eq("org_id", orgId)
    .eq("is_active", true);
  const overridden = new Set(
    detail.expenses
      .filter((x) => x.kind === "override")
      .map((x) => x.expense_item_id),
  );
  const snapshots = (standingRows ?? [])
    .filter((i) => !overridden.has(i.id))
    .map((i) => ({
      org_id: orgId,
      week_id: weekId,
      expense_item_id: i.id,
      name: i.name,
      category: i.category,
      amount: num(i.weekly_amount),
      kind: "snapshot" as const,
    }));
  if (snapshots.length > 0) {
    await supabase.from("week_expenses").insert(snapshots);
  }

  const { error } = await supabase
    .from("savings_weeks")
    .update({
      closed_at: new Date().toISOString(),
      closed_by: opts.by,
      income_total: detail.income,
      expenses_total: detail.expenses_total,
      saved_amount: opts.saved ?? detail.saved,
      target_amount: detail.target,
      ...(opts.notes !== undefined ? { notes: opts.notes } : {}),
    })
    .eq("org_id", orgId)
    .eq("id", weekId);
  if (error) throw new Error(`Failed to close the week: ${error.message}`);
}

/**
 * What stops this week closing.
 *
 * A week is the record of money that arrived, so anything that lands in the
 * bank has to be confirmed before the week is finished:
 *
 *   account   the invoice has to exist AND be paid. Work done on account with
 *             no invoice is money nobody has asked for yet, and closing over
 *             it is how a client goes unbilled for a month unnoticed.
 *   transfer  no invoice is expected, but the money still has to be marked
 *             received: it arrives days later, not in the room.
 *
 * Two things deliberately do NOT block: work that was not done (`skipped`, and
 * work that did not happen is not a debt) and anything settled in cash, which
 * is the escape hatch for a client who paid on the day. Switching a line to
 * cash is the honest way to say that is what happened.
 */
export function closeBlockers(entries: WeekEntry[]): CloseBlocker[] {
  return entries
    .filter((e) => e.status === "done" && e.method !== "cash" && !e.paid)
    .map((e) => ({
      entry_id: e.id,
      client_name: e.client_name,
      amount: e.amount + e.extra_amount,
      reason:
        e.method === "transfer"
          ? ("not_received" as const)
          : e.invoice_id
            ? ("not_paid" as const)
            : ("not_invoiced" as const),
      invoice_number: e.invoice_number ?? null,
    }));
}

function describeBlockers(blockers: CloseBlocker[]): string {
  const missing = blockers.filter((b) => b.reason === "not_invoiced");
  const unpaid = blockers.filter((b) => b.reason === "not_paid");
  const waiting = blockers.filter((b) => b.reason === "not_received");
  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(
      `${missing.map((b) => b.client_name).join(", ")} ${
        missing.length === 1 ? "has" : "have"
      } no invoice`,
    );
  }
  if (unpaid.length > 0) {
    parts.push(
      `${unpaid
        .map((b) =>
          b.invoice_number ? `#${b.invoice_number}` : b.client_name,
        )
        .join(", ")} ${unpaid.length === 1 ? "is" : "are"} unpaid`,
    );
  }
  if (waiting.length > 0) {
    parts.push(
      `${waiting.map((b) => b.client_name).join(", ")} ${
        waiting.length === 1 ? "has" : "have"
      } not transferred yet`,
    );
  }
  return parts.join(" and ");
}

/**
 * Reopen a closed week.
 *
 * Nothing is sealed: real life does not stop being wrong on Friday. The frozen
 * figures are cleared so the week goes back to being worked out live, and the
 * snapshot expense rows are removed so they do not double up with the standing
 * list. Overrides and one-offs stay: those were always this week's own.
 */
export async function reopenWeek(orgId: string, weekId: string): Promise<void> {
  const supabase = createAdminClient();

  await supabase
    .from("week_expenses")
    .delete()
    .eq("org_id", orgId)
    .eq("week_id", weekId)
    .eq("kind", "snapshot");

  const { error } = await supabase
    .from("savings_weeks")
    .update({
      closed_at: null,
      closed_by: null,
      income_total: null,
      expenses_total: null,
      saved_amount: null,
      target_amount: null,
    })
    .eq("org_id", orgId)
    .eq("id", weekId);
  if (error) throw new Error(`Failed to reopen the week: ${error.message}`);
}
