import Link from "next/link";
import { awesomeForPage } from "@/lib/data/org";
import { listPlans } from "@/lib/data/savings-plan";
import { listExpenseItems } from "@/lib/data/expenses";
import {
  ensureWeeks,
  entriesAndExpensesFor,
  figuresFor,
  stateOf,
} from "@/lib/data/weeks";
import { todayInSydney } from "@/lib/format";
import { aud } from "@/lib/savings";

/**
 * Every week, newest first.
 *
 * The overview answers "how is the month going". This answers "what happened in
 * March", which is a different question and the one asked less often, so it is
 * a plain list rather than a set of cards.
 */
export default async function WeeksPage() {
  const org = await awesomeForPage();
  const today = todayInSydney();

  const [plans, weeks, standing] = await Promise.all([
    listPlans(org.id),
    ensureWeeks(org.id, today),
    listExpenseItems(org.id),
  ]);
  // Each week is read against the plan it was run under, so a finished plan's
  // weeks keep being judged by what that plan asked for.
  const targets = new Map(plans.map((p) => [p.id, p.weekly_target]));
  const names = new Map(plans.map((p) => [p.id, p.name]));

  // Two queries for every week on the page, not two per week.
  const bulk = await entriesAndExpensesFor(
    org.id,
    weeks.map((w) => w.id),
  );
  const rows = weeks.map((w) => {
    const f = figuresFor(
      w,
      bulk.entries.get(w.id) ?? [],
      bulk.expenses.get(w.id) ?? [],
      standing,
      targets.get(w.plan_id) ?? 0,
    );
    return { week: w, state: stateOf(w, today), ...f };
  });

  const closed = rows.filter((r) => r.state === "closed");
  const saved = closed.reduce((s, r) => s + r.saved, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Weeks
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Every week of the plan, newest first
          </p>
        </div>
        <div className="flex gap-3">
          <Stat label="Weeks" value={String(rows.length)} />
          <Stat label="Closed" value={String(closed.length)} />
          <Stat label="Saved" value={aud(saved)} />
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-2xl bg-amber-50 p-6 text-sm text-amber-900 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:ring-amber-900">
          No weeks yet. The plan needs a start date before any week exists; set
          one on the{" "}
          <Link href="/savings/plan" className="font-semibold underline">
            Plan
          </Link>{" "}
          page.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">Week</th>
                <th className="px-4 py-3 font-medium">State</th>
                <th className="px-4 py-3 text-right font-medium">In</th>
                <th className="px-4 py-3 text-right font-medium">Out</th>
                <th className="px-4 py-3 text-right font-medium">Saved</th>
                <th className="px-4 py-3 text-right font-medium">Target</th>
                <th className="px-4 py-3 text-right font-medium">Against</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((r) => (
                <tr
                  key={r.week.id}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <td className="px-4 py-3">
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {r.week.week_start} to {r.week.week_end}
                    </span>
                    <div className="text-[11px] text-slate-400 dark:text-slate-500">
                      Week {r.week.rotation_week}
                      {names.get(r.week.plan_id) &&
                        ` · ${names.get(r.week.plan_id)}`}
                      {r.week.notes && ` · ${r.week.notes}`}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                        r.state === "closed"
                          ? r.saved >= r.target
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                            : "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300"
                          : r.state === "pending"
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                            : "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300"
                      }`}
                    >
                      {r.state}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400">
                    {aud(r.income)}
                  </td>
                  <td className="px-4 py-3 text-right text-rose-400 dark:text-rose-400/90">
                    {aud(r.expenses_total)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-semibold ${
                      r.saved < 0
                        ? "text-red-600 dark:text-red-400"
                        : "text-slate-900 dark:text-slate-100"
                    }`}
                  >
                    {aud(r.saved)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-500 dark:text-slate-400">
                    {aud(r.target)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right ${
                      r.against_target < 0
                        ? "text-red-600 dark:text-red-400"
                        : "text-emerald-600 dark:text-emerald-400"
                    }`}
                  >
                    {r.against_target >= 0 ? "+" : ""}
                    {aud(r.against_target)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/savings/weeks/${r.week.id}`}
                      className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
