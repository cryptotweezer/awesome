import { listClients } from "@/lib/data/clients";
import { listExpenseItems } from "@/lib/data/expenses";
import { awesomeForPage } from "@/lib/data/org";
import { currentPlan, weeksOf } from "@/lib/data/savings-plan";
import {
  addDays,
  entriesAndExpensesFor,
  lastServiceDates,
  listWeeks,
  weekIndexFor,
} from "@/lib/data/weeks";
import { todayInSydney } from "@/lib/format";
import { appliesToWeek, aud, isLongerCycle, nextDueOn } from "@/lib/savings";
import type { WeekEntry } from "@/lib/types";
import { RotationBoard, type CycleRow } from "./rotation-board";

export default async function SavingsRotationPage() {
  const org = await awesomeForPage();
  const today = todayInSydney();
  const [clients, items, lastDone, plan, weeks] = await Promise.all([
    listClients(org.id),
    listExpenseItems(org.id, { activeOnly: true }),
    lastServiceDates(org.id),
    // The plan is what turns a date into a week: which week of the rotation it
    // is, and whether that week has been opened yet.
    currentPlan(org.id, today),
    listWeeks(org.id),
  ]);

  const byStart = new Map(weeks.map((w) => [w.week_start, w]));
  const planWeeks = plan ? weeksOf(plan) : 0;

  /**
   * The week of the plan a date falls in.
   *
   * Null outside the plan: before it starts, after its last week, or when there
   * is no plan running. A monthly client due in a week nobody has planned yet is
   * an honest gap, not a week to invent.
   */
  function weekFor(date: string) {
    if (!plan || date < plan.starts_on || date > plan.ends_on) return null;
    const index = weekIndexFor(plan.starts_on, date);
    if (index < 1 || index > planWeeks) return null;
    const start = addDays(plan.starts_on, (index - 1) * 7);
    const week = byStart.get(start) ?? null;
    return {
      week_start: start,
      week_end: addDays(start, 6),
      // The rotation alternates from the plan's first week, the same way
      // `ensureWeeks` numbers them.
      rotation_week: index % 2 === 1 ? 1 : 2,
      week_id: week?.id ?? null,
    };
  }

  // The clients the two-week rotation cannot hold: monthly, every N weeks.
  // Their date is counted from the last service rather than stored, so it can
  // never disagree with what actually happened.
  const longer = clients.filter((c) => c.is_active && isLongerCycle(c));

  const placed = longer.map((c) => {
    const last = lastDone.get(c.id) ?? null;
    const due = last ? nextDueOn(c, last) : null;
    return { client: c, last, due, week: due ? weekFor(due) : null };
  });

  // Whether the week their date falls in already carries a line for them, which
  // is what says the money is expected there. One query for every week involved,
  // not one per client.
  const weekIds = [
    ...new Set(
      placed
        .map((p) => p.week?.week_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const bulk =
    weekIds.length > 0
      ? await entriesAndExpensesFor(org.id, weekIds)
      : {
          entries: new Map<string, WeekEntry[]>(),
          expenses: new Map<string, unknown[]>(),
        };

  const cycles: CycleRow[] = placed
    .map(({ client: c, last, due, week }) => ({
      id: c.id,
      name: c.name,
      cadence: c.cadence,
      cadence_weeks: c.cadence_weeks,
      rate: c.default_rate ?? 0,
      last_service_on: last,
      next_due_on: due,
      overdue: due !== null && due < today,
      week_start: week?.week_start ?? null,
      week_end: week?.week_end ?? null,
      rotation_week: week?.rotation_week ?? null,
      week_id: week?.week_id ?? null,
      scheduled: Boolean(
        week?.week_id &&
          (bulk.entries.get(week.week_id) ?? []).some(
            (e) => e.client_id === c.id,
          ),
      ),
    }))
    .sort((a, b) => (a.next_due_on ?? "9").localeCompare(b.next_due_on ?? "9"));

  // The standing weekly costs only. Loans are deliberately not on this screen:
  // it answers what a normal week takes in and what it costs, and the loans are
  // paid out of what is left, which is a different question on another page.
  // As of today: a cost that has not started yet is not part of what a normal
  // week costs right now, and counting it would make this week look dearer than
  // it is.
  const expenses = items
    .filter((i) => appliesToWeek(i, today))
    .reduce((sum, i) => sum + i.weekly_amount, 0);

  const active = clients.filter((c) => c.is_active);
  const rate = (c: (typeof active)[number]) => c.default_rate ?? 0;
  const week1 = active.filter((c) => c.in_week_1).reduce((s, c) => s + rate(c), 0);
  const week2 = active.filter((c) => c.in_week_2).reduce((s, c) => s + rate(c), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Rotation
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            Who is due in each of the two weeks, and what that should bring in.
            This is the plan, not the record: what actually happened in a given
            week is kept on that week.
          </p>
        </div>
        <div className="flex gap-3">
          <Stat label="Week 1" value={aud(week1)} />
          <Stat label="Week 2" value={aud(week2)} />
        </div>
      </div>

      <RotationBoard clients={clients} expenses={expenses} cycles={cycles} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white px-5 py-3 text-right shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
        {value}
      </p>
    </div>
  );
}
