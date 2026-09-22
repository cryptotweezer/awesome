import Link from "next/link";
import { awesomeForPage } from "@/lib/data/org";
import { currentPlan, listPlans } from "@/lib/data/savings-plan";
import { planProgress } from "@/lib/data/savings-progress";
import {
  ensureWeeks,
  entriesAndExpensesFor,
  figuresFor,
  stateOf,
  syncWeek,
} from "@/lib/data/weeks";
import { listExpenseItems } from "@/lib/data/expenses";
import { todayInSydney } from "@/lib/format";
import { aud, serviceDateFor, shortDate } from "@/lib/savings";
import type { SavingsWeek, WeekEntry, WeekExpense, WeekState } from "@/lib/types";
import { OpenWeeks } from "./open-weeks";

/**
 * How the plan is going, read the way the month is lived.
 *
 * Top: four cards, the current week and the three before it, skipping any that
 * is already closed. A month boundary is not where attention stops (on the 1st
 * the weeks just worked still matter), and a closed week is finished business
 * that belongs in the Weeks list, not in front of somebody every day. Bottom:
 * every week still open, however old, because clients pay monthly or every six
 * weeks and those weeks legitimately stay open long after they end. Without
 * that section they would fall off the bottom and be forgotten, which is
 * exactly the money worth chasing.
 */
export default async function SavingsOverviewPage() {
  const org = await awesomeForPage();
  const today = todayInSydney();

  const plan = await currentPlan(org.id, today);
  const weeks = await ensureWeeks(org.id, today);

  // Only the weeks on screen are brought into step with billing: syncing a year
  // of history on every page load would be a lot of work to change nothing.
  const recentWeeks = fourToWorkOn(weeks, today);
  const openWeeks = weeks.filter((w) => !w.closed_at);
  const toSync = new Set([...recentWeeks, ...openWeeks].map((w) => w.id));
  await Promise.all([...toSync].map((id) => syncWeek(org.id, id)));

  const [progress, standing] = await Promise.all([
    plan ? planProgress(org.id, plan, today) : null,
    listExpenseItems(org.id, { activeOnly: true }),
  ]);

  // The weeks on screen, each one once, and their rows in two queries rather
  // than two per week.
  const onScreen = [
    ...recentWeeks,
    ...openWeeks.filter((w) => !recentWeeks.some((r) => r.id === w.id)),
  ];
  const bulk = await entriesAndExpensesFor(
    org.id,
    onScreen.map((w) => w.id),
  );

  // A week is judged against the target of the plan it was run under, which is
  // not always the one running now: weeks stay open long after a plan ends.
  const plans = await listPlans(org.id);
  const targets = new Map(plans.map((p) => [p.id, p.weekly_target]));
  const byId = new Map(
    onScreen.map((w) => [
      w.id,
      summarise(
        w,
        bulk.entries.get(w.id) ?? [],
        bulk.expenses.get(w.id) ?? [],
        standing,
        targets.get(w.plan_id) ?? 0,
        today,
      ),
    ]),
  );


  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Overview
          </h1>
        </div>
        {progress && (
          <div className="flex flex-wrap gap-3">
            <Stat label="Saved so far" value={aud(progress.saved)} tone="in" />
            <Stat label="Plan asks by now" value={aud(progress.due_so_far)} />
            <Stat
              label={progress.ahead_by >= 0 ? "Ahead by" : "Behind by"}
              value={aud(Math.abs(progress.ahead_by))}
              tone={progress.ahead_by >= 0 ? "in" : "bad"}
            />
          </div>
        )}
      </div>

      {!plan && (
        <p className="rounded-2xl bg-amber-50 p-6 text-sm text-amber-900 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:ring-amber-900">
          No plan is running, so no new weeks are being opened. Start one on the{" "}
          <Link href="/savings/plan" className="font-semibold underline">
            Plan
          </Link>{" "}
          page. The weeks below are the ones already there, and they keep their
          figures whatever you start next.
        </p>
      )}

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Recent weeks
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            This week and the three before it · closed weeks move to{" "}
            <Link href="/savings/weeks" className="font-medium underline">
              Weeks
            </Link>
          </p>
        </div>

        {recentWeeks.length === 0 ? (
          <p className="rounded-2xl bg-white p-6 text-sm text-slate-500 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:ring-slate-800">
            Nothing to work on: every week that has started is closed.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {recentWeeks.map((w) => {
              const s = byId.get(w.id);
              if (!s) return null;
              return <WeekCard key={w.id} summary={s} />;
            })}
          </div>
        )}
      </section>

      <OpenWeeks
        weeks={openWeeks
          .map((w) => byId.get(w.id))
          .filter((s): s is Summary => Boolean(s))
          .sort((a, b) => a.week_start.localeCompare(b.week_start))}
      />
    </div>
  );
}

/**
 * The four most recent weeks still to work on, oldest first.
 *
 * Closing a week takes its card off this section: it is settled, and what it
 * ended up saving is in the Weeks list. The count stays at four rather than
 * leaving a hole, so closing one brings the next week still waiting up into
 * view, which is the one now worth looking at.
 *
 * Nothing after today is included. `ensureWeeks` only opens weeks up to today,
 * but the cut is written here too so a week created by hand further ahead
 * cannot appear before it has begun.
 */
function fourToWorkOn(weeks: SavingsWeek[], today: string): SavingsWeek[] {
  return weeks
    .filter((w) => !w.closed_at && w.week_start <= today)
    .sort((a, b) => b.week_start.localeCompare(a.week_start))
    .slice(0, 4)
    .reverse();
}

// -- one week, summarised ---------------------------------------------------

export type Summary = {
  id: string;
  week_start: string;
  week_end: string;
  rotation_week: number;
  state: WeekState;
  income: number;
  expected_income: number;
  outstanding: number;
  expenses: number;
  saved: number;
  surplus: number;
  target: number;
  against_target: number;
  done: number;
  expected: number;
  skipped: number;
  /** The clients invoiced for this week, and where each invoice stands. */
  billing: BillingLine[];
  /** What those invoices come to, whether or not they exist yet. */
  billing_total: number;
};

export type BillingLine = {
  entry_id: string;
  client_name: string;
  amount: number;
  invoice_id: string | null;
  invoice_number: number | null;
  paid: boolean;
  /**
   * Where this one goes: the invoice when it exists, the invoice form already
   * filled in when it does not. Null only for a line with no client behind it,
   * which there is nothing to prefill from.
   */
  href: string | null;
};

function summarise(
  week: SavingsWeek,
  entries: WeekEntry[],
  expenses: WeekExpense[],
  standing: Awaited<ReturnType<typeof listExpenseItems>>,
  weeklyTarget: number,
  today: string,
): Summary {
  const f = figuresFor(week, entries, expenses, standing, weeklyTarget);
  const billing = billingFor(week, entries);
  return {
    id: week.id,
    week_start: week.week_start,
    week_end: week.week_end,
    rotation_week: week.rotation_week,
    state: stateOf(week, today),
    income: f.income,
    expected_income: f.expected_income,
    outstanding: f.outstanding,
    expenses: f.expenses_total,
    saved: f.saved,
    surplus: f.surplus,
    target: f.target,
    against_target: f.against_target,
    done: entries.filter((e) => e.status === "done").length,
    expected: entries.filter((e) => e.status === "expected").length,
    skipped: entries.filter((e) => e.status === "skipped").length,
    billing,
    billing_total: billing.reduce((sum, b) => sum + b.amount, 0),
  };
}

/**
 * The clients this week has to invoice, and where each one stands.
 *
 * Only the lines billed on account: a cash client is settled on the day and a
 * transfer client is never invoiced, so neither has a document to chase.
 * Cancelled work is left out because there is nothing to bill for it.
 */
function billingFor(week: SavingsWeek, entries: WeekEntry[]): BillingLine[] {
  return entries
    .filter((e) => e.method === "account" && e.status !== "skipped")
    .map((e) => ({
      entry_id: e.id,
      client_name: e.client_name,
      amount: e.amount + e.extra_amount,
      invoice_id: e.invoice_id,
      invoice_number: e.invoice_number ?? null,
      paid: e.invoice_status === "paid",
      href: e.invoice_id
        ? `/invoices/${e.invoice_id}`
        : e.client_id
          ? `/invoices/new?${new URLSearchParams({
              client: e.client_id,
              // The day the work really happened, which is the key the week
              // reads the finished invoice back by.
              service_date: serviceDateFor(week.week_start, e.day),
              amount: String(e.amount),
              ...(e.extra_amount > 0
                ? { extra: String(e.extra_amount) }
                : {}),
              ...(e.extra_note ? { extra_note: e.extra_note } : {}),
            }).toString()}`
          : null,
    }))
    .sort((a, b) => a.client_name.localeCompare(b.client_name));
}

/**
 * One week, as a card.
 *
 * The big figure is the EXCESS: everything the week is meant to bring in, less
 * everything it costs. Not what has been collected, because a week is read
 * while it is running and on Monday nothing has been collected: a card showing
 * that would say every week starts as a catastrophe.
 *
 * Under it, the only work that needs chasing: the clients billed on account,
 * each with its invoice number or the word pending, and what they come to
 * together. That list is the week's actual to-do; the count of jobs done comes
 * last because by then it is a reassurance rather than a question.
 */
function WeekCard({ summary: s }: { summary: Summary }) {
  const met = s.surplus >= s.target;
  const over = s.surplus - s.target;
  const tone =
    s.state === "closed"
      ? met
        ? "ring-emerald-300 dark:ring-emerald-800"
        : "ring-red-300 dark:ring-red-900"
      : "ring-slate-200 dark:ring-slate-800";

  return (
    // The whole card opens the week, except where something on it opens
    // somewhere better. That is one overlay link under the content rather than
    // a link wrapping it: an anchor inside an anchor is not a thing, and the
    // invoice links have to be able to take a click of their own.
    <div
      className={`group relative rounded-2xl bg-white p-4 shadow-sm ring-1 transition hover:shadow-md dark:bg-slate-900 ${tone}`}
    >
      <Link
        href={`/savings/weeks/${s.id}`}
        aria-label={`Open the week of ${shortDate(s.week_start)}`}
        className="absolute inset-0 rounded-2xl"
      />
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {shortDate(s.week_start)} to {shortDate(s.week_end)}
          </p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            Week {s.rotation_week}
          </p>
        </div>
        <StateBadge state={s.state} met={met} />
      </div>

      <p className="mt-3 text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
        Excess
      </p>
      <p
        className={`text-2xl font-bold ${
          s.surplus < 0
            ? "text-red-600 dark:text-red-400"
            : met
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-slate-900 dark:text-slate-100"
        }`}
      >
        {aud(s.surplus)}
      </p>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        Savings target {aud(s.target)}
        <span
          className={
            over >= 0
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-500 dark:text-red-400"
          }
        >
          {" · "}
          {over >= 0 ? "+" : "-"}
          {aud(Math.abs(over))}
        </span>
      </p>

      {s.billing.length > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-2 dark:border-slate-800">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
              To invoice
            </p>
            <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              {aud(s.billing_total)}
            </p>
          </div>
          <ul className="mt-1 space-y-0.5">
            {s.billing.map((b) => {
              const label = b.invoice_id
                ? `#${b.invoice_number ?? "?"}${b.paid ? " paid" : ""}`
                : "pending";
              const stateTone = b.paid
                ? "text-emerald-600 dark:text-emerald-400"
                : b.invoice_id
                  ? "text-sky-600 dark:text-sky-400"
                  : "text-amber-600 dark:text-amber-400";
              return (
                <li
                  key={b.entry_id}
                  className="flex items-baseline justify-between gap-2 text-[11px]"
                >
                  <span className="truncate text-slate-600 dark:text-slate-400">
                    {b.client_name}
                  </span>
                  {b.href ? (
                    <Link
                      href={b.href}
                      title={
                        b.invoice_id
                          ? "Open the invoice"
                          : "Raise this invoice, already filled in"
                      }
                      className={`relative z-10 shrink-0 font-medium underline decoration-dotted underline-offset-2 hover:decoration-solid ${stateTone}`}
                    >
                      {label}
                    </Link>
                  ) : (
                    <span className={`shrink-0 font-medium ${stateTone}`}>
                      {label}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
        {s.done} done
        {s.expected > 0 && ` · ${s.expected} to go`}
        {s.skipped > 0 && ` · ${s.skipped} cancelled`}
      </p>
    </div>
  );
}

export function StateBadge({
  state,
  met,
}: {
  state: WeekState;
  met: boolean;
}) {
  if (state === "closed") {
    return (
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
          met
            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
            : "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300"
        }`}
      >
        Closed
      </span>
    );
  }
  if (state === "pending") {
    return (
      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
        Pending
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-800 dark:bg-sky-950/60 dark:text-sky-300">
      Open
    </span>
  );
}

const TONES = {
  plain: "text-slate-900 dark:text-slate-100",
  in: "text-emerald-600 dark:text-emerald-400",
  bad: "text-red-600 dark:text-red-400",
} as const;

function Stat({
  label,
  value,
  tone = "plain",
}: {
  label: string;
  value: string;
  tone?: keyof typeof TONES;
}) {
  return (
    <div className="rounded-2xl bg-white px-5 py-3 text-right shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className={`text-2xl font-bold ${TONES[tone]}`}>{value}</p>
    </div>
  );
}
