import "server-only";
import {
  listClients,
  setClientRotation,
  updateClient,
} from "@/lib/data/clients";
import { AWESOME_ORG_ID, getOrg } from "@/lib/data/org";
import {
  createExpenseItem,
  deleteExpenseItem,
  listExpenseItems,
  updateExpenseItem,
} from "@/lib/data/expenses";
import {
  createLoan,
  deleteLoan,
  deleteLoanPayment,
  listLoanPayments,
  listLoans,
  recordLoanPayment,
  updateLoan,
} from "@/lib/data/loans";
import {
  currentPlan,
  listPlans,
  plannedTotal,
  updatePlan,
  weeksOf,
} from "@/lib/data/savings-plan";
import { planProgress } from "@/lib/data/savings-progress";
import {
  addEntry,
  closeBlockers,
  closeWeek,
  deleteEntry,
  deleteWeekExpense,
  ensureWeeks,
  entriesAndExpensesFor,
  figuresFor,
  getEntry,
  getWeekDetail,
  lastServiceDates,
  listWeeks,
  reopenWeek,
  setWeekExpense,
  stateOf,
  syncWeek,
  updateEntry,
  updateWeek,
} from "@/lib/data/weeks";
import {
  deleteVaultMovement,
  listVaultMovements,
  recordVaultMovement,
  vaultStatus,
} from "@/lib/data/vault";
import { taxYear } from "@/lib/data/tax";
import { todayInSydney } from "@/lib/format";
import {
  WEEKDAYS,
  isLongerCycle,
  methodFor,
  nextDueOn,
  serviceDateFor,
  weekdayLabel,
} from "@/lib/savings";
import type { ToolDef, ToolInput } from "@/lib/gateway/tools";
import type {
  BillingType,
  Cadence,
  ExpenseCategory,
  ExpenseItem,
  LoanWithBalance,
  SavingsWeek,
  VaultName,
  WeekEntry,
} from "@/lib/types";

/**
 * The savings plan, for agents.
 *
 * These tools exist only for Awesome. The savings plan is not part of the
 * billing app that other businesses use, so a guest must never see them in a
 * tool list, let alone be told about them in a briefing: a tool an agent cannot
 * call is worse than no tool, because it will try.
 *
 * Everything a person can do on the savings screens is here, and the reverse.
 * That is the whole promise of the gateway, and the fastest way to break it is
 * to add a button without its tool.
 */

// -- helpers ----------------------------------------------------------------

function obj(
  properties: Record<string, unknown>,
  required?: string[],
): Record<string, unknown> {
  return required?.length
    ? { type: "object", required, properties }
    : { type: "object", properties };
}

const NO_ARGS = obj({});
const DATE = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } as const;

function str(input: ToolInput, key: string): string | null {
  const v = input[key];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function need(input: ToolInput, key: string): string {
  const v = str(input, key);
  if (!v) throw new Error(`Missing required "${key}"`);
  return v;
}

function num(input: ToolInput, key: string): number | null {
  const v = input[key];
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`"${key}" must be a number`);
  return n;
}

/**
 * Which week is meant.
 *
 * Agents are told about weeks in words, so the words are accepted: "this week",
 * "last week", or any date inside the one wanted. A UUID works too, because an
 * earlier answer handed one over.
 */
async function weekFor(orgId: string, input: ToolInput): Promise<SavingsWeek> {
  const today = todayInSydney();
  const weeks = await ensureWeeks(orgId, today);
  if (weeks.length === 0) {
    throw new Error(
      "No plan is running, so no week exists yet. The owner starts one on the Plan page.",
    );
  }

  const byStart = [...weeks].sort((a, b) => a.week_start.localeCompare(b.week_start));
  const current =
    byStart.filter((w) => w.week_start <= today).slice(-1)[0] ?? byStart[0];

  const id = str(input, "week_id");
  if (id) {
    const found = weeks.find((w) => w.id === id);
    if (!found) throw new Error(`No week ${id}`);
    return found;
  }

  const raw = (str(input, "week") ?? "").toLowerCase();
  if (raw === "" || raw === "this week" || raw === "current") return current;
  if (raw === "last week" || raw === "previous") {
    const i = byStart.findIndex((w) => w.id === current.id);
    if (i <= 0) throw new Error("There is no week before this one");
    return byStart[i - 1];
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const found = weeks.find((w) => w.week_start <= raw && raw <= w.week_end);
    if (!found) throw new Error(`No week covers ${raw}`);
    return found;
  }

  throw new Error(
    `Cannot tell which week "${raw}" means. Use a date inside it (YYYY-MM-DD), "this week" or "last week".`,
  );
}

/** The line for one client in one week, found by name the way a person says it. */
async function entryFor(
  orgId: string,
  weekId: string,
  input: ToolInput,
): Promise<WeekEntry> {
  const detail = await getWeekDetail(orgId, weekId);
  if (!detail) throw new Error("Week not found");

  const id = str(input, "entry_id");
  if (id) {
    const found = detail.entries.find((e) => e.id === id);
    if (!found) throw new Error(`No line ${id} in that week`);
    return found;
  }

  const name = need(input, "client").toLowerCase();
  const matches = detail.entries.filter((e) =>
    e.client_name.toLowerCase().includes(name),
  );
  if (matches.length === 0) {
    throw new Error(
      `Nobody matching "${name}" is in that week. Use add_week_job to record work for somebody who was not due.`,
    );
  }
  if (matches.length > 1) {
    const exact = matches.find((e) => e.client_name.toLowerCase() === name);
    if (exact) return exact;
    throw new Error(
      `"${name}" matches ${matches.length}: ${matches.map((m) => m.client_name).join(", ")}. Be more specific.`,
    );
  }
  return matches[0];
}

/**
 * A fixed cost, by name or by id.
 *
 * By name because that is what an agent is told ("the insurance went up"), and
 * the names of seventeen standing costs are unambiguous in practice. A partial
 * name that matches two is refused rather than guessed at.
 */
async function expenseFor(
  orgId: string,
  input: ToolInput,
): Promise<ExpenseItem> {
  const items = await listExpenseItems(orgId);
  const id = str(input, "expense_id");
  if (id) {
    const found = items.find((i) => i.id === id);
    if (!found) throw new Error("No such cost");
    return found;
  }
  const name = need(input, "name").toLowerCase();
  const exact = items.filter((i) => i.name.toLowerCase() === name);
  const matches = exact.length > 0
    ? exact
    : items.filter((i) => i.name.toLowerCase().includes(name));
  if (matches.length === 0) throw new Error(`No cost called "${name}"`);
  if (matches.length > 1) {
    throw new Error(
      `"${name}" matches ${matches.length}: ${matches.map((m) => m.name).join(", ")}`,
    );
  }
  return matches[0];
}

/** A loan, by name or by id, refusing an ambiguous name rather than guessing. */
async function loanFor(
  orgId: string,
  input: ToolInput,
): Promise<LoanWithBalance> {
  const loans = await listLoans(orgId);
  const id = str(input, "loan_id");
  if (id) {
    const found = loans.find((l) => l.id === id);
    if (!found) throw new Error("No such loan");
    return found;
  }
  const name = need(input, "name").toLowerCase();
  const exact = loans.filter((l) => l.name.toLowerCase() === name);
  const matches = exact.length > 0
    ? exact
    : loans.filter((l) => l.name.toLowerCase().includes(name));
  if (matches.length === 0) throw new Error(`No loan called "${name}"`);
  if (matches.length > 1) {
    throw new Error(
      `"${name}" matches ${matches.length}: ${matches.map((m) => m.name).join(", ")}`,
    );
  }
  return matches[0];
}

/** A client of this business, by name or by id. */
async function clientFor(orgId: string, input: ToolInput) {
  const clients = await listClients(orgId);
  const id = str(input, "client_id");
  if (id) {
    const found = clients.find((c) => c.id === id);
    if (!found) throw new Error("No such client");
    return found;
  }
  const name = need(input, "client").toLowerCase();
  const exact = clients.filter((c) => c.name.toLowerCase() === name);
  const matches = exact.length > 0
    ? exact
    : clients.filter((c) => c.name.toLowerCase().includes(name));
  if (matches.length === 0) throw new Error(`No client called "${name}"`);
  if (matches.length > 1) {
    throw new Error(
      `"${name}" matches ${matches.length}: ${matches.map((m) => m.name).join(", ")}`,
    );
  }
  return matches[0];
}

function dayNumber(input: ToolInput, key = "day"): number | null {
  const raw = str(input, key);
  if (!raw) return null;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 1 && n <= 7) return n;
  const found = WEEKDAYS.find(
    (d) =>
      d.label.toLowerCase() === raw.toLowerCase() ||
      d.short.toLowerCase() === raw.toLowerCase(),
  );
  if (!found) throw new Error(`"${raw}" is not a day of the week`);
  return found.value;
}

function describeWeek(
  week: SavingsWeek,
  figures: ReturnType<typeof figuresFor>,
  entries: WeekEntry[],
  today: string,
) {
  const blockers = closeBlockers(entries);
  return {
    week_id: week.id,
    from: week.week_start,
    to: week.week_end,
    rotation_week: week.rotation_week,
    state: stateOf(week, today),
    income: figures.income,
    // What the week comes to if it goes to plan: every job not cancelled,
    // whether its day has come round yet or not. On a Monday this is the only
    // figure worth reading.
    expected_income: figures.expected_income,
    received: figures.received,
    still_to_arrive: figures.outstanding,
    expenses: figures.expenses_total,
    // Who pays the week. Cash and transfers are in hand the week the work is
    // done, so they cover the costs first; only `short_from_invoicing` has to
    // wait on an invoice. Asked "did the cash cover the week", read these.
    cash_in: figures.cash_in,
    invoiced_in: figures.invoiced_in,
    covered_by_cash: figures.covered_by_cash,
    short_from_invoicing: figures.short_from_invoicing,
    cash_left: figures.cash_left,
    saved: figures.saved,
    surplus: figures.surplus,
    target: figures.target,
    against_target: figures.against_target,
    done: entries.filter((e) => e.status === "done").length,
    still_to_do: entries.filter((e) => e.status === "expected").length,
    cancelled: entries.filter((e) => e.status === "skipped").length,
    // What has to happen on the billing side before this week can close. An
    // agent asked "what does this week need" should read these out.
    to_invoice: blockers
      .filter((b) => b.reason === "not_invoiced")
      .map((b) => ({ client: b.client_name, amount: b.amount })),
    invoiced_not_paid: blockers
      .filter((b) => b.reason === "not_paid")
      .map((b) => ({
        client: b.client_name,
        invoice_number: b.invoice_number,
        amount: b.amount,
      })),
    // Never invoiced, money by transfer: all these wait for is the payment.
    transfer_not_received: blockers
      .filter((b) => b.reason === "not_received")
      .map((b) => ({ client: b.client_name, amount: b.amount })),
    can_close: blockers.length === 0,
    notes: week.notes,
  };
}

// -- the tools --------------------------------------------------------------

export const savingsTools: Record<string, ToolDef> = {
  savings_overview: {
    scope: "read",
    description:
      "READ THIS BEFORE ANY OTHER SAVINGS TOOL. How the savings plan is going: the weekly " +
      "target, what has been saved, whether that is ahead of or behind what the plan asks " +
      "by now, the current week, and every week still open with what each is waiting on. " +
      "The loans are paid down week by week, alongside the saving: one does not wait for the other.",
    schema: NO_ARGS,
    handler: async (_input, ctx) => {
      const orgId = ctx.agent.orgId;
      const today = todayInSydney();
      const plan = await currentPlan(orgId, today);
      const weeks = await ensureWeeks(orgId, today);
      const [progress, standing, loans, plans] = await Promise.all([
        plan ? planProgress(orgId, plan, today) : null,
        listExpenseItems(orgId, { activeOnly: true }),
        listLoans(orgId, { activeOnly: true }),
        listPlans(orgId),
      ]);

      const open = weeks.filter((w) => !w.closed_at);
      const bulk = await entriesAndExpensesFor(
        orgId,
        open.map((w) => w.id),
      );
      const targets = new Map(plans.map((p) => [p.id, p.weekly_target]));

      // A business runs one plan at a time and keeps the ones before it. With
      // no plan running there is nothing to be ahead or behind of, and saying
      // so is the answer rather than a set of zeros.
      const finished = plans
        .filter((p) => !plan || p.id !== plan.id)
        .map((p) => {
          const mine = weeks.filter((w) => w.plan_id === p.id && w.closed_at);
          const saved = mine.reduce((sum, w) => sum + (w.saved_amount ?? 0), 0);
          const total = plannedTotal(p);
          return {
            name: p.name,
            from: p.starts_on,
            to: p.ends_on,
            weekly_target: p.weekly_target,
            target_total: total,
            saved,
            percent: total > 0 ? Math.round((saved / total) * 100) : 0,
            met: saved >= total,
          };
        });

      return {
        today,
        plan: plan
          ? {
              name: plan.name,
              started_on: plan.starts_on,
              ends_on: plan.ends_on,
              weekly_target: plan.weekly_target,
              horizon_months: plan.horizon_months,
              running: progress?.running ?? false,
              finished: progress?.finished ?? false,
              current_week: progress?.current_week ?? 0,
              total_weeks: progress?.total_weeks ?? weeksOf(plan),
            }
          : null,
        progress: progress
          ? {
              // What the weeks confirmed, what has since left the vault, and
              // what is therefore still saved. The last one is the answer.
              saved_by_the_weeks: progress.saved,
              taken_out_of_the_vault: progress.taken_out,
              saved: progress.net_saved,
              plan_asks_by_now: progress.due_so_far,
              ahead_by: progress.ahead_by,
              target_total: progress.target_total,
              percent: progress.percent,
              met: progress.met,
              weeks_closed: progress.weeks_closed,
              weeks_over_target: progress.weeks_won,
              weeks_level: progress.weeks_even,
              weeks_under: progress.weeks_lost,
            }
          : null,
        plans_before_this: finished,
        // Each milestone measures its OWN stretch, not everything up to it: a
        // month that has not started reads zero rather than inheriting the
        // months before it.
        milestones: progress?.milestones ?? [],
        loans_first: {
          still_owed: loans.reduce((s, l) => s + l.balance, 0),
          weekly: loans
            .filter((l) => l.balance > 0)
            .reduce((s, l) => s + l.weekly_payment, 0),
          note: "Paid down week by week, alongside the saving.",
        },
        open_weeks: open
          .sort((a, b) => a.week_start.localeCompare(b.week_start))
          .map((w) => {
            const entries = bulk.entries.get(w.id) ?? [];
            const f = figuresFor(
              w,
              entries,
              bulk.expenses.get(w.id) ?? [],
              standing,
              // Judged by the plan it was run under, which for a week still
              // open is not always the plan running now.
              targets.get(w.plan_id) ?? 0,
            );
            return describeWeek(w, f, entries, today);
          }),
      };
    },
  },

  savings_week: {
    scope: "read",
    description:
      'One week in full: every client due, whether the work was done, which day it happened, ' +
      'what it came to, what has been paid and what has not, and what the week cost. ' +
      'Args: week ("this week", "last week", or any date inside it) or week_id.',
    schema: obj({
      week: {
        type: "string",
        description: '"this week", "last week", or a date inside the week (YYYY-MM-DD).',
      },
      week_id: { type: "string" },
    }),
    handler: async (input, ctx) => {
      const orgId = ctx.agent.orgId;
      const week = await weekFor(orgId, input);
      await syncWeek(orgId, week.id);
      const detail = await getWeekDetail(orgId, week.id);
      if (!detail) throw new Error("Week not found");
      const today = todayInSydney();

      return {
        ...describeWeek(
          detail.week,
          {
            income: detail.income,
            expected_income: detail.expected_income,
            received: detail.received,
            outstanding: detail.outstanding,
            expenses_total: detail.expenses_total,
            cash_in: detail.cash_in,
            invoiced_in: detail.invoiced_in,
            covered_by_cash: detail.covered_by_cash,
            short_from_invoicing: detail.short_from_invoicing,
            cash_left: detail.cash_left,
            saved: detail.saved,
            surplus: detail.surplus,
            target: detail.target,
            against_target: detail.against_target,
          },
          detail.entries,
          today,
        ),
        work: detail.entries.map((e) => ({
          entry_id: e.id,
          client: e.client_name,
          one_off: e.source === "oneoff",
          status: e.status,
          day: weekdayLabel(e.day),
          amount: e.amount,
          extra: e.extra_amount,
          extra_note: e.extra_note,
          method: e.method,
          paid: e.paid,
          paid_on: e.paid_on,
          invoiced: e.invoice_id !== null,
          invoice_number: e.invoice_number ?? null,
          invoice_status: e.invoice_status ?? null,
          note: e.note,
        })),
        costs: detail.expenses.map((x) => ({
          name: x.name,
          amount: x.amount,
          kind: x.kind,
          category: x.category,
          note: x.note,
        })),
      };
    },
  },

  savings_weeks: {
    scope: "read",
    description:
      "A list of weeks with what each came to, newest first. Use it for questions about a " +
      "month or a stretch of time. Args: from, to (YYYY-MM-DD, optional), limit (default 12), " +
      "open_only (true for the ones not yet closed).",
    schema: obj({
      from: DATE,
      to: DATE,
      limit: { type: "number" },
      open_only: { type: "boolean" },
    }),
    handler: async (input, ctx) => {
      const orgId = ctx.agent.orgId;
      const today = todayInSydney();
      await ensureWeeks(orgId, today);
      const targets = new Map(
        (await listPlans(orgId)).map((p) => [p.id, p.weekly_target]),
      );
      const weeks = await listWeeks(orgId, {
        from: str(input, "from") ?? undefined,
        to: str(input, "to") ?? undefined,
        openOnly: input.open_only === true,
        limit: num(input, "limit") ?? 12,
      });
      const standing = await listExpenseItems(orgId, { activeOnly: true });
      const bulk = await entriesAndExpensesFor(
        orgId,
        weeks.map((w) => w.id),
      );
      return weeks.map((w) => {
        const entries = bulk.entries.get(w.id) ?? [];
        const f = figuresFor(
          w,
          entries,
          bulk.expenses.get(w.id) ?? [],
          standing,
          targets.get(w.plan_id) ?? 0,
        );
        return describeWeek(w, f, entries, today);
      });
    },
  },

  rotation: {
    scope: "read",
    description:
      "Who is normally done in each of the two rotation weeks, by day, with what each should " +
      "bring in, plus longer_cycle: the monthly and every-N-weeks clients, who are on neither " +
      "week and carry their own next date, counted from their last service (overdue when that " +
      "date has gone by). This is the plan, not what happened: use savings_week for a real week.",
    schema: NO_ARGS,
    handler: async (_input, ctx) => {
      const orgId = ctx.agent.orgId;
      const clients = (await listClients(orgId)).filter((c) => c.is_active);
      const side = (n: 1 | 2) =>
        WEEKDAYS.map((d) => ({
          day: d.label,
          clients: clients
            .filter(
              (c) =>
                (n === 1 ? c.in_week_1 : c.in_week_2) &&
                (n === 1 ? c.week_1_day : c.week_2_day) === d.value,
            )
            .sort(
              (a, b) =>
                ((n === 1 ? a.week_1_seq : a.week_2_seq) ?? 999) -
                ((n === 1 ? b.week_1_seq : b.week_2_seq) ?? 999),
            )
            .map((c) => ({
              name: c.name,
              rate: c.default_rate,
              paid: methodFor(c.billing_type),
            })),
        })).filter((d) => d.clients.length > 0);

      // The clients the two-week rotation cannot hold, with the date counted
      // from their last service. An agent asked "who is due soon" has to see
      // these: between visits they are on no week at all.
      const lastDone = await lastServiceDates(orgId);
      const longerCycle = clients
        .filter((c) => c.is_active && isLongerCycle(c))
        .map((c) => {
          const last = lastDone.get(c.id) ?? null;
          const due = last ? nextDueOn(c, last) : null;
          return {
            name: c.name,
            every: c.cadence === "monthly" ? "month" : `${c.cadence_weeks} weeks`,
            rate: c.default_rate,
            last_service_on: last,
            next_due_on: due,
            overdue: due !== null && due < todayInSydney(),
          };
        })
        .sort((a, b) => (a.next_due_on ?? "9").localeCompare(b.next_due_on ?? "9"));

      return {
        week_1: side(1),
        week_2: side(2),
        longer_cycle: longerCycle,
        not_on_the_rotation: clients
          .filter((c) => !c.in_week_1 && !c.in_week_2)
          .map((c) => ({
            name: c.name,
            cadence: c.cadence,
            rate: c.default_rate,
            note: "Recorded in whichever week the work actually happens.",
          })),
      };
    },
  },

  weekly_expenses: {
    scope: "read",
    description:
      "The standing weekly costs, grouped by where they belong (Australia, Colombia, Visa). " +
      "These are what a normal week costs; a week that cost something different is recorded " +
      "on that week and does not change these. An item with a `starts_on` date did not always " +
      "exist and is only counted from that week onwards, so a week before it pays less.",
    schema: NO_ARGS,
    handler: async (_input, ctx) => {
      const items = await listExpenseItems(ctx.agent.orgId, {
        activeOnly: true,
      });
      const by = (c: string) => items.filter((i) => i.category === c);
      const total = (c: string) =>
        by(c).reduce((s, i) => s + i.weekly_amount, 0);
      return {
        total_per_week: items.reduce((s, i) => s + i.weekly_amount, 0),
        australia: { total: total("australia"), items: by("australia") },
        colombia: { total: total("colombia"), items: by("colombia") },
        visa: { total: total("visa"), items: by("visa") },
      };
    },
  },

  loans_status: {
    scope: "read",
    description:
      "Every loan: what was borrowed, what has been paid, what is still owed, the weekly " +
      "payment and how many weeks are left. The loans are the first goal; saving starts " +
      "once they are cleared.",
    schema: obj({
      include_payments: {
        type: "boolean",
        description: "Include each loan's payment history.",
      },
    }),
    handler: async (input, ctx) => {
      const orgId = ctx.agent.orgId;
      const loans = await listLoans(orgId);
      const withHistory = input.include_payments === true;
      const payments = withHistory
        ? await Promise.all(loans.map((l) => listLoanPayments(orgId, l.id)))
        : [];
      return {
        still_owed: loans
          .filter((l) => l.is_active)
          .reduce((s, l) => s + l.balance, 0),
        weekly: loans
          .filter((l) => l.is_active && l.balance > 0)
          .reduce((s, l) => s + l.weekly_payment, 0),
        loans: loans.map((l, i) => ({
          loan_id: l.id,
          name: l.name,
          borrowed: l.principal,
          paid: l.paid,
          still_owed: l.balance,
          weekly_payment: l.weekly_payment,
          weeks_left: l.weeks_left,
          started_on: l.started_on,
          ends_on: l.ends_on,
          active: l.is_active,
          ...(withHistory ? { payments: payments[i] } : {}),
        })),
      };
    },
  },

  // -- writes ---------------------------------------------------------------

  mark_service: {
    scope: "write",
    description:
      "Record the EXCEPTION to one client's week. Ordinary work needs nothing: the round is " +
      "regular, so a job whose day has gone by is recorded as done by itself. What needs " +
      'saying is what changed: the client cancelled (status "cancelled"), it happened on a ' +
      "different day (day), it came to more than usual (extra). " +
      'Say "X cancelled this week" and that money simply does not come in that week; no other ' +
      "week is affected. Moving the day keeps the week's record of when it really happened and " +
      "never touches the rotation. " +
      "For an INVOICED client, marking the work done is only half of it: raise the invoice " +
      "with create_invoice using the day it happened as the line's service_date, and the week " +
      "picks the invoice up by itself. Until then the week shows the work as not invoiced and " +
      "will not close. A client who transfers without an invoice needs no document, only " +
      "record_week_payment once the money lands. " +
      'Args: client (name), week (optional, defaults to this week), status ("cancelled" | ' +
      '"done" | "planned"), day, amount, extra, extra_note, note.',
    schema: obj({
      client: { type: "string", description: "The client's name." },
      entry_id: { type: "string" },
      week: { type: "string" },
      week_id: { type: "string" },
      status: {
        type: "string",
        enum: ["done", "cancelled", "not_done", "planned", "to_do"],
        description:
          'What happened. "cancelled" (or "not_done") is the one worth saying: the work did ' +
          'not happen and the money does not come in. "planned" puts a line back to waiting.',
      },
      day: { type: "string", description: 'A weekday name, or 1 to 7 with 1 = Monday.' },
      amount: { type: "number" },
      extra: { type: "number", description: "Additional work on top of the usual job." },
      extra_note: { type: "string" },
      note: { type: "string" },
    }),
    handler: async (input, ctx) => {
      const orgId = ctx.agent.orgId;
      const week = await weekFor(orgId, input);
      if (week.closed_at) {
        throw new Error(
          `That week is closed. Reopen it with reopen_savings_week if it needs correcting.`,
        );
      }
      await syncWeek(orgId, week.id);
      const entry = await entryFor(orgId, week.id, input);

      const raw = str(input, "status");
      const status =
        raw === "not_done" || raw === "skipped" || raw === "cancelled"
          ? "skipped"
          : raw === "to_do" || raw === "expected" || raw === "planned"
            ? "expected"
            : raw === "done"
              ? "done"
              : undefined;

      const amount = num(input, "amount");
      const extra = num(input, "extra");
      const day = dayNumber(input);

      await updateEntry(orgId, entry.id, {
        ...(status ? { status } : {}),
        ...(day !== null ? { day } : {}),
        ...(amount !== null ? { amount } : {}),
        ...(extra !== null ? { extra_amount: extra } : {}),
        ...(str(input, "extra_note") ? { extra_note: str(input, "extra_note") } : {}),
        ...(str(input, "note") ? { note: str(input, "note") } : {}),
        // Cash is handed over as the work finishes, so marking it done marks it
        // paid unless somebody says otherwise. Not done is never paid.
        ...(status === "done" && entry.method === "cash" && !entry.paid
          ? { paid: true, paid_on: todayInSydney() }
          : {}),
        ...(status === "skipped" ? { paid: false, paid_on: null } : {}),
      });

      const detail = await getWeekDetail(orgId, week.id);
      const after = detail?.entries.find((e) => e.id === entry.id);
      return {
        recorded: entry.client_name,
        week: `${week.week_start} to ${week.week_end}`,
        saved_now: detail?.saved,
        still_to_arrive: detail?.outstanding,
        // Said plainly, because it is the next thing to do and the reason the
        // week will refuse to close.
        ...(after &&
        after.status === "done" &&
        after.method === "account" &&
        !after.invoice_id
          ? {
              needs_invoice: {
                client: after.client_name,
                service_date: serviceDateFor(week.week_start, after.day),
                amount: after.amount + after.extra_amount,
                note: "Raise the invoice with this service_date so the week links to it.",
              },
            }
          : {}),
      };
    },
  },

  record_week_payment: {
    scope: "write",
    description:
      "Record that a client's money for a week has come in. For an INVOICED client, mark the " +
      "invoice paid instead (mark_paid): this week reads the invoice, and recording a payment " +
      "twice is how two sets of books start to disagree. This tool is for the clients with no " +
      "invoice behind them: cash handed over, and the ones who transfer without ever being " +
      "invoiced. Args: client, week, paid_on, amount (optional, if it differed).",
    schema: obj({
      client: { type: "string" },
      entry_id: { type: "string" },
      week: { type: "string" },
      week_id: { type: "string" },
      paid_on: DATE,
      amount: { type: "number" },
      note: { type: "string" },
    }),
    handler: async (input, ctx) => {
      const orgId = ctx.agent.orgId;
      const week = await weekFor(orgId, input);
      if (week.closed_at) throw new Error("That week is closed.");
      const entry = await entryFor(orgId, week.id, input);

      if (entry.invoice_id) {
        throw new Error(
          `${entry.client_name} is invoiced for that week. Mark the invoice paid with mark_paid and this line follows it.`,
        );
      }

      const amount = num(input, "amount");
      await updateEntry(orgId, entry.id, {
        status: "done",
        paid: true,
        paid_on: str(input, "paid_on") ?? todayInSydney(),
        ...(amount !== null ? { amount } : {}),
        ...(str(input, "note") ? { note: str(input, "note") } : {}),
      });

      const detail = await getWeekDetail(orgId, week.id);
      return {
        paid: entry.client_name,
        week: `${week.week_start} to ${week.week_end}`,
        still_to_arrive: detail?.outstanding,
      };
    },
  },

  add_week_job: {
    scope: "write",
    idempotent: true,
    description:
      "Add work to a week that the rotation did not expect: a client done off their usual " +
      "rhythm, or a one-off job for somebody who is not a client at all. A one-off creates " +
      "nobody in the client list; it belongs to that week and nowhere else. " +
      "Args: client (an existing client's name) OR description (a one-off), amount, week, day, " +
      'method ("cash" | "account").',
    schema: obj(
      {
        client: { type: "string", description: "An existing client's name." },
        description: {
          type: "string",
          description: "For a one-off job: what it was. Creates no client.",
        },
        amount: { type: "number" },
        week: { type: "string" },
        week_id: { type: "string" },
        day: { type: "string" },
        method: { type: "string", enum: ["cash", "account"] },
        note: { type: "string" },
        idempotency_key: { type: "string" },
      },
      ["amount"],
    ),
    handler: async (input, ctx) => {
      const orgId = ctx.agent.orgId;
      const week = await weekFor(orgId, input);
      if (week.closed_at) throw new Error("That week is closed.");

      const amount = num(input, "amount");
      if (amount === null || amount < 0) {
        throw new Error("Give the amount, at least 0");
      }

      const name = str(input, "client");
      let clientId: string | null = null;
      let label = str(input, "description");

      if (name) {
        const clients = await listClients(orgId);
        const matches = clients.filter(
          (c) =>
            c.is_active && c.name.toLowerCase().includes(name.toLowerCase()),
        );
        if (matches.length === 0) throw new Error(`No client matches "${name}"`);
        const exact = matches.find(
          (c) => c.name.toLowerCase() === name.toLowerCase(),
        );
        const client = matches.length === 1 ? matches[0] : exact;
        if (!client) {
          throw new Error(
            `"${name}" matches ${matches.length}: ${matches.map((m) => m.name).join(", ")}. Be more specific.`,
          );
        }
        clientId = client.id;
        label = client.name;
      }

      if (!label) {
        throw new Error(
          "Give client (an existing client) or description (a one-off job).",
        );
      }

      const method = str(input, "method") === "account" ? "account" : "cash";
      await addEntry(orgId, {
        week_id: week.id,
        client_id: clientId,
        client_name: label,
        source: clientId ? "adhoc" : "oneoff",
        amount,
        day: dayNumber(input),
        method,
        paid: method === "cash",
        note: str(input, "note"),
      });

      const detail = await getWeekDetail(orgId, week.id);
      return {
        added: label,
        one_off: clientId === null,
        week: `${week.week_start} to ${week.week_end}`,
        income_now: detail?.income,
        saved_now: detail?.saved,
      };
    },
  },

  set_week_cost: {
    scope: "write",
    description:
      "Say what a standing expense really cost in one week, or add a cost that happened once. " +
      "Neither touches the standing list, so no other week moves and no past week is rewritten. " +
      'Args: name (the expense, or what the one-off was), amount, week, category for a one-off ' +
      '("australia" | "colombia" | "visa").',
    schema: obj(
      {
        name: { type: "string" },
        amount: { type: "number" },
        week: { type: "string" },
        week_id: { type: "string" },
        category: { type: "string", enum: ["australia", "colombia", "visa"] },
        note: { type: "string" },
      },
      ["name", "amount"],
    ),
    handler: async (input, ctx) => {
      const orgId = ctx.agent.orgId;
      const week = await weekFor(orgId, input);
      if (week.closed_at) throw new Error("That week is closed.");

      const name = need(input, "name");
      const amount = num(input, "amount");
      if (amount === null || amount < 0) {
        throw new Error("Give the amount, at least 0");
      }

      const standing = await listExpenseItems(orgId, { activeOnly: true });
      const match = standing.find(
        (i) =>
          i.name.toLowerCase() === name.toLowerCase() ||
          i.name.toLowerCase().includes(name.toLowerCase()),
      );

      await setWeekExpense(orgId, week.id, {
        expense_item_id: match?.id ?? null,
        name: match?.name ?? name,
        category:
          match?.category ??
          ((str(input, "category") ?? "australia") as ExpenseCategory),
        amount,
        kind: match ? "override" : "oneoff",
        note: str(input, "note"),
      });

      const detail = await getWeekDetail(orgId, week.id);
      return {
        recorded: match?.name ?? name,
        as: match ? "this week only, the usual amount is unchanged" : "a one-off",
        week: `${week.week_start} to ${week.week_end}`,
        week_costs_now: detail?.expenses_total,
        saved_now: detail?.saved,
      };
    },
  },

  close_savings_week: {
    scope: "write",
    description:
      "Close a week, confirming what was saved. Ask the owner to confirm the figure before " +
      "calling this: the number recorded here is what the plan counts. Anything whose money " +
      "arrives by bank has to have landed first, or the call is refused naming who is " +
      "missing: an invoiced client needs the invoice raised AND paid, a transfer client needs " +
      "the payment recorded. Cash never blocks. " +
      "Only pass force:true if the owner says to close it with that money still out. " +
      "A closed week can always be reopened. " +
      "Args: week, saved (optional, defaults to what the week comes to), notes, force.",
    schema: obj({
      week: { type: "string" },
      week_id: { type: "string" },
      saved: { type: "number" },
      notes: { type: "string" },
      force: {
        type: "boolean",
        description:
          "Close although invoiced work is unbilled or unpaid. Only on the owner's word.",
      },
    }),
    handler: async (input, ctx) => {
      const orgId = ctx.agent.orgId;
      const week = await weekFor(orgId, input);
      await syncWeek(orgId, week.id);
      const saved = num(input, "saved");
      await closeWeek(orgId, week.id, {
        saved: saved ?? undefined,
        by: ctx.agent.label,
        notes: str(input, "notes"),
        force: input.force === true,
      });
      const after = await getWeekDetail(orgId, week.id);
      return {
        closed: `${week.week_start} to ${week.week_end}`,
        saved: after?.saved,
        target: after?.target,
        against_target: after?.against_target,
      };
    },
  },

  reopen_savings_week: {
    scope: "write",
    description:
      "Reopen a closed week so it can be corrected. Nothing is sealed: a client who pays late " +
      "or a cost that turns up afterwards is normal. The frozen figures are cleared and the " +
      "week goes back to being worked out live.",
    schema: obj({ week: { type: "string" }, week_id: { type: "string" } }),
    handler: async (input, ctx) => {
      const orgId = ctx.agent.orgId;
      const week = await weekFor(orgId, input);
      if (!week.closed_at) throw new Error("That week is not closed.");
      await reopenWeek(orgId, week.id);
      return { reopened: `${week.week_start} to ${week.week_end}` };
    },
  },

  set_week_notes: {
    scope: "write",
    description:
      "Put a note on a week. Anything unusual worth remembering later. Never printed anywhere.",
    schema: obj({ notes: { type: "string" }, week: { type: "string" }, week_id: { type: "string" } }),
    handler: async (input, ctx) => {
      const orgId = ctx.agent.orgId;
      const week = await weekFor(orgId, input);
      await updateWeek(orgId, week.id, { notes: str(input, "notes") });
      return { week: `${week.week_start} to ${week.week_end}`, saved: true };
    },
  },

  record_loan_payment: {
    scope: "write",
    idempotent: true,
    description:
      "Record a payment against a loan. The balance follows the payments, so this is the only " +
      "place a loan goes down. Leave `from_vault` out for the ordinary payment, which comes out " +
      "of the week's money and never touches the saving. Pass \"aus\" or \"col\" only when the " +
      "owner says the money came out of that vault, and it is then deducted from it (refused if " +
      "the vault does not hold it). Either way the payment is recorded once, here. " +
      "Args: loan (name), amount, paid_on (defaults to today), from_vault, note.",
    schema: obj(
      {
        loan: { type: "string" },
        loan_id: { type: "string" },
        amount: { type: "number" },
        paid_on: DATE,
        from_vault: {
          type: "string",
          enum: ["aus", "col"],
          description:
            "Only when the payment came out of the saving. Left out otherwise.",
        },
        note: { type: "string" },
        idempotency_key: { type: "string" },
      },
      ["amount"],
    ),
    handler: async (input, ctx) => {
      const orgId = ctx.agent.orgId;
      const amount = num(input, "amount");
      if (amount === null || amount <= 0) {
        throw new Error("Give the amount, more than 0");
      }

      const loans = await listLoans(orgId, { activeOnly: true });
      const id = str(input, "loan_id");
      const name = str(input, "loan");
      let loan = id ? loans.find((l) => l.id === id) : undefined;
      if (!loan && name) {
        const matches = loans.filter((l) =>
          l.name.toLowerCase().includes(name.toLowerCase()),
        );
        if (matches.length > 1) {
          throw new Error(
            `"${name}" matches ${matches.length}: ${matches.map((m) => m.name).join(", ")}. Be more specific.`,
          );
        }
        loan = matches[0];
      }
      if (!loan) {
        if (loans.length === 1) loan = loans[0];
        else throw new Error("Which loan? Name it, or use loans_status to list them.");
      }

      const fromVault = str(input, "from_vault")?.toLowerCase() ?? null;
      if (fromVault !== null && fromVault !== "aus" && fromVault !== "col") {
        throw new Error('from_vault is "aus", "col", or left out entirely');
      }

      await recordLoanPayment(orgId, {
        loan_id: loan.id,
        amount,
        from_vault: fromVault,
        paid_on: str(input, "paid_on") ?? todayInSydney(),
        note: str(input, "note"),
        recorded_by: ctx.agent.label,
      });

      const after = await listLoans(orgId, { activeOnly: true });
      const updated = after.find((l) => l.id === loan.id);
      const vault = fromVault ? await vaultStatus(orgId) : null;
      return {
        loan: loan.name,
        paid: amount,
        paid_from: fromVault ? `Vault ${fromVault.toUpperCase()}` : "the week's money",
        still_owed: updated?.balance,
        weeks_left: updated?.weeks_left,
        settled: (updated?.balance ?? 0) <= 0,
        ...(vault
          ? { vault_aus: vault.aus, vault_col: vault.col, total_saved: vault.total }
          : {}),
      };
    },
  },

  update_savings_plan: {
    scope: "write",
    description:
      "Change the plan that is running: the weekly amount to save, how long it runs in " +
      "months, the day week 1 starts, its name or its notes. A business runs one plan at a " +
      "time and keeps the ones before it, so this never touches a finished plan and cannot " +
      "start a new one: starting and deleting plans is done by the owner in the dashboard, " +
      "because a plan is what every week is judged against. The weeks already closed keep " +
      "what they saved and are re-read against the new target. " +
      "Args: weekly_target, horizon_months, starts_on, name, notes.",
    schema: obj({
      weekly_target: { type: "number" },
      horizon_months: { type: "number" },
      starts_on: { ...DATE, description: "The day week 1 begins." },
      name: { type: "string" },
      notes: { type: "string" },
    }),
    handler: async (input, ctx) => {
      const orgId = ctx.agent.orgId;
      const target = num(input, "weekly_target");
      const months = num(input, "horizon_months");
      const startsOn = str(input, "starts_on");

      if (target !== null && target < 0) {
        throw new Error("The weekly amount cannot be negative");
      }
      if (months !== null && (!Number.isInteger(months) || months < 1)) {
        throw new Error("The horizon must be a whole number of months");
      }

      const running = await currentPlan(orgId);
      if (!running) {
        throw new Error(
          "No plan is running. The owner starts one on the Plan page: a plan is what every " +
            "week is measured against, so it is not something to create on somebody's behalf.",
        );
      }

      const plan = await updatePlan(orgId, running.id, {
        ...(target !== null ? { weekly_target: target } : {}),
        ...(months !== null ? { horizon_months: months } : {}),
        ...(startsOn ? { starts_on: startsOn } : {}),
        ...(str(input, "name") ? { name: str(input, "name") } : {}),
        ...(str(input, "notes") ? { notes: str(input, "notes") } : {}),
      });

      const progress = await planProgress(orgId, plan);
      return {
        name: plan.name,
        weekly_target: plan.weekly_target,
        horizon_months: plan.horizon_months,
        starts_on: plan.starts_on,
        ends_on: plan.ends_on,
        total_over_the_plan: progress.target_total,
        saved_so_far: progress.net_saved,
        ahead_by: progress.ahead_by,
        note: "Weeks are created from the start date up to today, and never past the plan's last week, the next time anything reads them.",
      };
    },
  },

  // -- the vault ------------------------------------------------------------

  vault_status: {
    scope: "read",
    description:
      "What has ACTUALLY been saved, which is not what the weeks were worth. A week's excess " +
      "is what it should leave over; the vault holds what was confirmed when it closed. Two " +
      "balances, both in AUD: Vault AUS, saved but still reachable, and Vault COL, money sent " +
      "to Colombia and frozen, shown beside the pesos it turned into. Nothing here is stored: " +
      "it is the closed weeks plus the movements, so correcting an old week fixes the vault " +
      "by itself. A loan paid out of the vault is in here too, as the loan payment it is. " +
      "Read this before any question about savings totals.",
    schema: NO_ARGS,
    handler: async (_input, ctx) => {
      const orgId = ctx.agent.orgId;
      const [status, movements] = await Promise.all([
        vaultStatus(orgId),
        listVaultMovements(orgId, 10),
      ]);
      return {
        ...status,
        recent_movements: movements.map((m) => ({
          id: m.id,
          on: m.occurred_on,
          what:
            m.kind === "transfer"
              ? "sent to Vault COL"
              : m.kind === "withdrawal"
                ? `taken out of Vault ${m.vault.toUpperCase()}`
                : `put into Vault ${m.vault.toUpperCase()}`,
          amount: m.amount,
          rate: m.rate,
          pesos: m.amount_cop,
          reason: m.reason,
          by: m.recorded_by,
        })),
      };
    },
  },

  send_to_vault_col: {
    scope: "write",
    description:
      "Record a transfer from Vault AUS to Vault COL, which is money sent to Colombia and " +
      "frozen there. The owner makes the transfer himself on Wise; this records what it was. " +
      "Give the rate of the day OR the pesos that arrived and the other is worked out, because " +
      "the rate belonged to that minute and cannot be looked up afterwards. Refused if Vault " +
      "AUS does not hold the amount. Args: amount (AUD, required), rate, pesos, on, note.",
    schema: obj(
      {
        amount: { type: "number", description: "AUD leaving Vault AUS." },
        rate: { type: "number", description: "Pesos per AUD on the day." },
        pesos: { type: "number", description: "What arrived in COP." },
        on: { ...DATE, description: "The day it moved. Defaults to today." },
        note: { type: "string" },
      },
      ["amount"],
    ),
    handler: async (input, ctx) => {
      const orgId = ctx.agent.orgId;
      const amount = num(input, "amount");
      if (amount === null || amount <= 0) {
        throw new Error("The amount must be more than 0");
      }
      const movement = await recordVaultMovement(orgId, {
        kind: "transfer",
        vault: "aus",
        amount,
        rate: num(input, "rate"),
        amount_cop: num(input, "pesos"),
        occurred_on: str(input, "on") ?? todayInSydney(),
        reason: null,
        note: str(input, "note"),
        recorded_by: ctx.agent.label,
      });
      const status = await vaultStatus(orgId);
      return {
        sent: movement.amount,
        rate: movement.rate,
        pesos: movement.amount_cop,
        on: movement.occurred_on,
        vault_aus: status.aus,
        vault_col: status.col,
        total_saved: status.total,
      };
    },
  },

  record_vault_withdrawal: {
    scope: "write",
    description:
      "Record money leaving a vault for something else. This is not a normal outgoing: the " +
      "weekly costs belong to their week. This is the saving itself being spent, so the plan " +
      "falls behind until it is put back, and the reason is required. Ask the owner what it " +
      "was for rather than inventing a reason. Refused if the vault does not hold the amount. " +
      "Args: amount (required), reason (required), vault (aus or col, defaults to aus), on, note.",
    schema: obj(
      {
        amount: { type: "number" },
        reason: { type: "string", description: "What it was really for." },
        vault: { type: "string", enum: ["aus", "col"] },
        on: { ...DATE, description: "The day it moved. Defaults to today." },
        note: { type: "string" },
      },
      ["amount", "reason"],
    ),
    handler: async (input, ctx) => {
      const orgId = ctx.agent.orgId;
      const amount = num(input, "amount");
      if (amount === null || amount <= 0) {
        throw new Error("The amount must be more than 0");
      }
      const vault = (str(input, "vault") ?? "aus").toLowerCase() as VaultName;
      if (vault !== "aus" && vault !== "col") {
        throw new Error('The vault is "aus" or "col"');
      }
      const movement = await recordVaultMovement(orgId, {
        kind: "withdrawal",
        vault,
        amount,
        rate: num(input, "rate"),
        amount_cop: num(input, "pesos"),
        occurred_on: str(input, "on") ?? todayInSydney(),
        reason: need(input, "reason"),
        note: str(input, "note"),
        recorded_by: ctx.agent.label,
      });
      const status = await vaultStatus(orgId);
      return {
        taken: movement.amount,
        out_of: `Vault ${vault.toUpperCase()}`,
        reason: movement.reason,
        vault_aus: status.aus,
        vault_col: status.col,
        total_saved: status.total,
      };
    },
  },

  record_vault_deposit: {
    scope: "write",
    description:
      "Put money into a vault that did not come from a week: replenishing after a withdrawal, " +
      "or money from outside the business. A week's saving needs no deposit, it lands in Vault " +
      "AUS the moment the week is closed, so never use this to record one. " +
      "Args: amount (required), vault (aus or col, defaults to aus), reason, on, note.",
    schema: obj(
      {
        amount: { type: "number" },
        vault: { type: "string", enum: ["aus", "col"] },
        reason: { type: "string", description: "Where it came from." },
        on: { ...DATE, description: "The day it moved. Defaults to today." },
        note: { type: "string" },
      },
      ["amount"],
    ),
    handler: async (input, ctx) => {
      const orgId = ctx.agent.orgId;
      const amount = num(input, "amount");
      if (amount === null || amount <= 0) {
        throw new Error("The amount must be more than 0");
      }
      const vault = (str(input, "vault") ?? "aus").toLowerCase() as VaultName;
      if (vault !== "aus" && vault !== "col") {
        throw new Error('The vault is "aus" or "col"');
      }
      const movement = await recordVaultMovement(orgId, {
        kind: "deposit",
        vault,
        amount,
        rate: num(input, "rate"),
        amount_cop: num(input, "pesos"),
        occurred_on: str(input, "on") ?? todayInSydney(),
        reason: str(input, "reason"),
        note: str(input, "note"),
        recorded_by: ctx.agent.label,
      });
      const status = await vaultStatus(orgId);
      return {
        put_in: movement.amount,
        into: `Vault ${vault.toUpperCase()}`,
        vault_aus: status.aus,
        vault_col: status.col,
        total_saved: status.total,
      };
    },
  },

  delete_vault_movement: {
    scope: "delete",
    description:
      "Remove a vault movement entered by mistake. The balances follow on their own. Confirm " +
      "with the owner first: this is money history, and a transfer to Colombia deleted by " +
      "accident takes its rate and its pesos with it. Get the id from vault_status.",
    schema: obj({ movement_id: { type: "string" } }, ["movement_id"]),
    handler: async (input, ctx) => {
      const orgId = ctx.agent.orgId;
      await deleteVaultMovement(orgId, need(input, "movement_id"));
      const status = await vaultStatus(orgId);
      return {
        deleted: true,
        vault_aus: status.aus,
        vault_col: status.col,
        total_saved: status.total,
      };
    },
  },

  // -- the standing list, the loans and the rotation -------------------------

  set_weekly_expense: {
    scope: "write",
    description:
      "Add a fixed weekly cost, or change one. These are what a NORMAL week costs, so this " +
      "changes every week from now on; a week that cost something different once is " +
      "`set_week_cost` instead, which touches that week only. " +
      "`counts_from` is for a cost that did not always exist: leave it out and every week " +
      "counts it, including the ones before today, which is right for a cost that has always " +
      "been there and wrong for one that started in October. `where` is australia, colombia " +
      "or visa, and it is only a grouping. " +
      "Args: name (required), amount, where, counts_from, expense_id (to change one).",
    schema: obj(
      {
        name: { type: "string" },
        amount: { type: "number", description: "What it costs in a normal week." },
        where: { type: "string", enum: ["australia", "colombia", "visa"] },
        counts_from: {
          ...DATE,
          description:
            "The week this cost starts counting from. Left out, it counts in every week.",
        },
        expense_id: { type: "string" },
      },
      ["name"],
    ),
    handler: async (input, ctx) => {
      const orgId = ctx.agent.orgId;
      const name = need(input, "name");
      const amount = num(input, "amount");
      if (amount !== null && amount < 0) {
        throw new Error("A cost cannot be negative");
      }

      const items = await listExpenseItems(orgId);
      const id = str(input, "expense_id");
      const found =
        (id ? items.find((i) => i.id === id) : undefined) ??
        items.find((i) => i.name.toLowerCase() === name.toLowerCase());

      const where = (str(input, "where") ?? "australia") as ExpenseCategory;
      const startsOn = str(input, "counts_from");

      if (found) {
        const saved = await updateExpenseItem(orgId, found.id, {
          name,
          ...(amount !== null ? { weekly_amount: amount } : {}),
          ...(str(input, "where") ? { category: where } : {}),
          ...("counts_from" in input ? { starts_on: startsOn } : {}),
          is_active: true,
        });
        return {
          changed: saved.name,
          per_week: saved.weekly_amount,
          where: saved.category,
          counts_from: saved.starts_on ?? "every week",
          note: "Future weeks only. No week that has already closed moves.",
        };
      }

      if (amount === null) throw new Error("Give the amount for a new cost");
      const saved = await createExpenseItem(orgId, {
        name,
        weekly_amount: amount,
        category: where,
        starts_on: startsOn,
      });
      return {
        added: saved.name,
        per_week: saved.weekly_amount,
        where: saved.category,
        counts_from: saved.starts_on ?? "every week",
      };
    },
  },

  archive_weekly_expense: {
    scope: "write",
    description:
      "Stop counting a fixed weekly cost, without deleting it. The right way to end a cost " +
      "that really existed: the weeks that already closed keep it, because they paid it. " +
      "Pass restore:true to bring it back. Args: name or expense_id, restore.",
    schema: obj({
      name: { type: "string" },
      expense_id: { type: "string" },
      restore: { type: "boolean" },
    }),
    handler: async (input, ctx) => {
      const orgId = ctx.agent.orgId;
      const item = await expenseFor(orgId, input);
      const active = input.restore === true;
      await updateExpenseItem(orgId, item.id, { is_active: active });
      return {
        [active ? "counting_again" : "stopped"]: item.name,
        note: active
          ? "Counted in every open week again."
          : "Open weeks stop counting it. Closed weeks keep what they paid.",
      };
    },
  },

  delete_weekly_expense: {
    scope: "delete",
    description:
      "Delete a fixed weekly cost entered by mistake. For a cost that really existed and has " +
      "ended, use archive_weekly_expense instead: deleting it takes it out of every OPEN " +
      "week's total as if it had never been paid. Closed weeks are unaffected either way, " +
      "since they froze their own costs. Confirm with the owner first.",
    schema: obj({ name: { type: "string" }, expense_id: { type: "string" } }),
    handler: async (input, ctx) => {
      const orgId = ctx.agent.orgId;
      const item = await expenseFor(orgId, input);
      await deleteExpenseItem(orgId, item.id);
      return { deleted: item.name };
    },
  },

  set_loan: {
    scope: "write",
    description:
      "Add a loan, or change one. `owed` is what was borrowed in the first place, not what is " +
      "left: the balance is worked out from the payments recorded against it, so it is never " +
      "typed in. `weekly` is what comes out for it in a normal week, which is counted in the " +
      "week's outgoings. Args: name (required), owed, weekly, started_on, ends_on, notes, " +
      "loan_id (to change one).",
    schema: obj(
      {
        name: { type: "string" },
        owed: { type: "number", description: "The original amount borrowed." },
        weekly: { type: "number" },
        started_on: DATE,
        ends_on: DATE,
        notes: { type: "string" },
        loan_id: { type: "string" },
      },
      ["name"],
    ),
    handler: async (input, ctx) => {
      const orgId = ctx.agent.orgId;
      const name = need(input, "name");
      const owed = num(input, "owed");
      const weekly = num(input, "weekly");
      if (owed !== null && owed < 0) throw new Error("A loan cannot be negative");
      if (weekly !== null && weekly < 0) {
        throw new Error("A weekly payment cannot be negative");
      }

      const loans = await listLoans(orgId);
      const id = str(input, "loan_id");
      const found =
        (id ? loans.find((l) => l.id === id) : undefined) ??
        loans.find((l) => l.name.toLowerCase() === name.toLowerCase());

      if (found) {
        const saved = await updateLoan(orgId, found.id, {
          name,
          ...(owed !== null ? { principal: owed } : {}),
          ...(weekly !== null ? { weekly_payment: weekly } : {}),
          ...(str(input, "started_on")
            ? { started_on: str(input, "started_on") }
            : {}),
          ...(str(input, "ends_on") ? { ends_on: str(input, "ends_on") } : {}),
          ...(str(input, "notes") ? { notes: str(input, "notes") } : {}),
          is_active: true,
        });
        const after = (await listLoans(orgId)).find((l) => l.id === saved.id);
        return {
          changed: saved.name,
          borrowed: saved.principal,
          paid: after?.paid,
          still_owed: after?.balance,
          per_week: saved.weekly_payment,
        };
      }

      if (owed === null) throw new Error("Give the amount borrowed for a new loan");
      const saved = await createLoan(orgId, {
        name,
        principal: owed,
        weekly_payment: weekly ?? 0,
        started_on: str(input, "started_on"),
        ends_on: str(input, "ends_on"),
        notes: str(input, "notes"),
      });
      return {
        added: saved.name,
        borrowed: saved.principal,
        per_week: saved.weekly_payment,
        note: "The balance follows the payments recorded against it.",
      };
    },
  },

  archive_loan: {
    scope: "write",
    description:
      "Put a loan away without deleting it: settled, written off, or no longer tracked. Its " +
      "payments stay. Pass restore:true to bring it back. Args: name or loan_id, restore.",
    schema: obj({
      name: { type: "string" },
      loan_id: { type: "string" },
      restore: { type: "boolean" },
    }),
    handler: async (input, ctx) => {
      const orgId = ctx.agent.orgId;
      const loan = await loanFor(orgId, input);
      const active = input.restore === true;
      await updateLoan(orgId, loan.id, { is_active: active });
      return { [active ? "tracking_again" : "archived"]: loan.name };
    },
  },

  delete_loan: {
    scope: "delete",
    description:
      "Delete a loan AND every payment recorded against it. For a loan that was really paid " +
      "off, archive_loan is the right tool: deleting it erases the record of the money that " +
      "went into it. Confirm with the owner first. Args: name or loan_id.",
    schema: obj({ name: { type: "string" }, loan_id: { type: "string" } }),
    handler: async (input, ctx) => {
      const orgId = ctx.agent.orgId;
      const loan = await loanFor(orgId, input);
      const payments = await listLoanPayments(orgId, loan.id);
      await deleteLoan(orgId, loan.id);
      return { deleted: loan.name, payments_deleted: payments.length };
    },
  },

  delete_loan_payment: {
    scope: "delete",
    description:
      "Remove a loan payment entered wrongly. The balance follows the payments, so it corrects " +
      "itself. If the payment came out of a vault, that money returns to the vault as well. " +
      "Get the id from loans_status. Args: payment_id.",
    schema: obj({ payment_id: { type: "string" } }, ["payment_id"]),
    handler: async (input, ctx) => {
      const orgId = ctx.agent.orgId;
      await deleteLoanPayment(orgId, need(input, "payment_id"));
      return { deleted: true };
    },
  },

  set_client_rhythm: {
    scope: "write",
    description:
      "How often a client is done, how they pay, and where they sit in the two-week rotation. " +
      "The rotation PRE-FILLS a week, it does not decide what happened: moving somebody here " +
      "changes the weeks still to come, never one that has already run. " +
      "`pays` is invoice (a document, into the account), transfer (into the account, no " +
      "document) or cash (in hand); only an invoice client can ever be billed. " +
      "`every` is weekly, fortnightly, monthly, every_n_weeks (with every_weeks) or " +
      "occasional. Monthly and every-N-week clients are NOT on the rotation: their next visit " +
      "is counted from the last one actually done. " +
      "For the rotation, `week_1` and `week_2` each take a weekday (Monday..Sunday or 1..7), " +
      "\"any\" for in the week with no day chosen yet, or \"out\" to take them out of it. " +
      "Args: client (name, required), pays, every, every_weeks, rate, week_1, week_2.",
    schema: obj(
      {
        client: { type: "string" },
        client_id: { type: "string" },
        pays: { type: "string", enum: ["invoice", "transfer", "cash"] },
        every: {
          type: "string",
          enum: [
            "weekly",
            "fortnightly",
            "monthly",
            "every_n_weeks",
            "occasional",
          ],
        },
        every_weeks: { type: "number" },
        rate: { type: "number", description: "What they are charged a visit." },
        week_1: { type: "string" },
        week_2: { type: "string" },
      },
      ["client"],
    ),
    handler: async (input, ctx) => {
      const orgId = ctx.agent.orgId;
      const client = await clientFor(orgId, input);

      const pays = str(input, "pays") as BillingType | null;
      const every = str(input, "every") as Cadence | null;
      const everyWeeks = num(input, "every_weeks");
      const rate = num(input, "rate");

      if (every === "every_n_weeks" && (everyWeeks === null || everyWeeks < 2)) {
        throw new Error('every_n_weeks needs every_weeks, 2 or more');
      }

      if (pays || every || rate !== null || everyWeeks !== null) {
        await updateClient(orgId, client.id, {
          ...(pays ? { billing_type: pays } : {}),
          ...(every ? { cadence: every } : {}),
          ...(everyWeeks !== null ? { cadence_weeks: everyWeeks } : {}),
          ...(rate !== null ? { default_rate: rate } : {}),
        });
      }

      // The two rotation weeks are independent, so each is set on its own.
      for (const week of [1, 2] as const) {
        const raw = str(input, `week_${week}`);
        if (raw === null) continue;
        const word = raw.toLowerCase();
        if (word === "out" || word === "remove" || word === "no") {
          await setClientRotation(orgId, client.id, week, false, null);
          continue;
        }
        const day = word === "any" ? null : dayNumber({ d: raw }, "d");
        await setClientRotation(orgId, client.id, week, true, day);
      }

      const after = (await listClients(orgId)).find((c) => c.id === client.id);
      return {
        client: client.name,
        pays: after?.billing_type,
        every: after?.cadence,
        every_weeks: after?.cadence_weeks,
        rate: after?.default_rate,
        week_1: after?.in_week_1
          ? weekdayLabel(after.week_1_day ?? null)
          : "not in week 1",
        week_2: after?.in_week_2
          ? weekdayLabel(after.week_2_day ?? null)
          : "not in week 2",
        note: "Weeks still to come are pre-filled from this. Weeks already run do not move.",
      };
    },
  },

  delete_week_job: {
    scope: "delete",
    description:
      "Remove a line from a week entirely, for one added by mistake. Work that was simply not " +
      "done is `mark_service` with done:false instead, which keeps the line and the record " +
      "that it was cancelled. A line that follows an invoice comes back the next time the " +
      "week is read, because the invoice is what put it there. Args: entry_id.",
    schema: obj({ entry_id: { type: "string" } }, ["entry_id"]),
    handler: async (input, ctx) => {
      const orgId = ctx.agent.orgId;
      const id = need(input, "entry_id");
      const entry = await getEntry(orgId, id);
      if (!entry) throw new Error("That line does not exist");
      await deleteEntry(orgId, id);
      return { deleted: entry.client_name };
    },
  },

  delete_week_cost: {
    scope: "delete",
    description:
      "Undo something recorded on ONE week's costs: an amount that was different that week, " +
      "or a one-off. The standing list is untouched, so the week goes back to costing what a " +
      "normal week costs. Get the id from savings_week. Args: cost_id.",
    schema: obj({ cost_id: { type: "string" } }, ["cost_id"]),
    handler: async (input, ctx) => {
      const orgId = ctx.agent.orgId;
      await deleteWeekExpense(orgId, need(input, "cost_id"));
      return { deleted: true };
    },
  },

  tax_position: {
    scope: "read",
    description:
      "How much each ABN has billed this financial year and how much room is left before that " +
      "person is taxed. PER PERSON, never added together: each ABN belongs to somebody and " +
      "each of them has their own tax-free threshold. " +
      "An invoice counts in the year of its invoice date, a cancelled one does not count at " +
      "all, and GST is taken out where there is any, because GST collected was never income. " +
      "IMPORTANT when answering: the threshold is on that person's WHOLE income for the year, " +
      "so a wage from another job or anything invoiced outside this business counts towards " +
      "the same figure and is not in here. Say that rather than telling the owner they have " +
      "room they may not have. Args: fy_start (optional, to read an earlier year).",
    schema: obj({
      fy_start: {
        ...DATE,
        description:
          "The first day of the financial year to read. Defaults to the one running now.",
      },
    }),
    handler: async (input, ctx) => {
      const org = await getOrg(ctx.agent.orgId);
      if (!org) throw new Error("Business not found");
      const year = await taxYear(org, str(input, "fy_start") ?? undefined);
      return {
        financial_year: year.fy_label,
        from: year.fy_start,
        to: year.fy_end,
        tax_free_threshold: year.threshold,
        per_abn: year.issuers.map((i) => ({
          who: i.short_name,
          name: i.full_name,
          abn: i.abn,
          invoices: i.invoices,
          billed: i.billed,
          paid: i.paid,
          income_for_tax: i.income,
          room_left: i.room,
          over_by: i.over,
          percent_of_threshold: i.percent,
          ...(i.is_active ? {} : { archived: true }),
        })),
        business_total_billed: year.billed,
        business_total_paid: year.paid,
        note:
          "The threshold is per person and covers their whole income, not just what this " +
          "business billed. Room left is only the part still billable here.",
      };
    },
  },
};

/**
 * Whether this business has a savings plan at all.
 *
 * Only Awesome does. Everyone else is running the billing app, where these
 * tools would be a list of things that cannot work, and an agent told about a
 * tool will try it.
 */
export function hasSavings(orgId: string): boolean {
  return orgId === AWESOME_ORG_ID;
}
