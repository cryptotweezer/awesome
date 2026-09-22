import "server-only";
import { listClients } from "@/lib/data/clients";
import { AWESOME_ORG_ID } from "@/lib/data/org";
import { listExpenseItems } from "@/lib/data/expenses";
import { listLoanPayments, listLoans, recordLoanPayment } from "@/lib/data/loans";
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
  ensureWeeks,
  entriesAndExpensesFor,
  figuresFor,
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
import type { ExpenseCategory, SavingsWeek, WeekEntry } from "@/lib/types";

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
      "The loans come first: saving does not start until they are paid.",
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
              saved: progress.saved,
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
        milestones: progress?.milestones ?? [],
        loans_first: {
          still_owed: loans.reduce((s, l) => s + l.balance, 0),
          weekly: loans
            .filter((l) => l.balance > 0)
            .reduce((s, l) => s + l.weekly_payment, 0),
          note: "Saving starts once these are cleared.",
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
      "on that week and does not change these.",
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
      "place a loan goes down. Args: loan (name), amount, paid_on (defaults to today), note.",
    schema: obj(
      {
        loan: { type: "string" },
        loan_id: { type: "string" },
        amount: { type: "number" },
        paid_on: DATE,
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

      await recordLoanPayment(orgId, {
        loan_id: loan.id,
        amount,
        paid_on: str(input, "paid_on") ?? todayInSydney(),
        note: str(input, "note"),
        recorded_by: ctx.agent.label,
      });

      const after = await listLoans(orgId, { activeOnly: true });
      const updated = after.find((l) => l.id === loan.id);
      return {
        loan: loan.name,
        paid: amount,
        still_owed: updated?.balance,
        weeks_left: updated?.weeks_left,
        settled: (updated?.balance ?? 0) <= 0,
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
        saved_so_far: progress.saved,
        ahead_by: progress.ahead_by,
        note: "Weeks are created from the start date up to today, and never past the plan's last week, the next time anything reads them.",
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
