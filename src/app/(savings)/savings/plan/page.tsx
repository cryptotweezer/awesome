import Link from "next/link";
import { listLoans } from "@/lib/data/loans";
import { awesomeForPage } from "@/lib/data/org";
import {
  currentPlan,
  listPlans,
  plannedTotal,
  weeksOf,
} from "@/lib/data/savings-plan";
import { planProgress } from "@/lib/data/savings-progress";
import { todayInSydney } from "@/lib/format";
import { aud } from "@/lib/savings";
import { listWeeks } from "@/lib/data/weeks";
import { PlanPanel, type PlanResult } from "./plan-form";

export default async function SavingsPlanPage() {
  const org = await awesomeForPage();
  const today = todayInSydney();

  const [plans, loans, weeks] = await Promise.all([
    listPlans(org.id),
    listLoans(org.id, { activeOnly: true }),
    // Read, never ensured: this page describes the plans, and opening weeks is
    // the overview's job.
    listWeeks(org.id),
  ]);

  const running = await currentPlan(org.id, today);

  // Each plan's result, from its own weeks. The figures of a closed week were
  // frozen as it closed, so a finished plan's result cannot move afterwards.
  const results: PlanResult[] = plans.map((plan) => {
    const mine = weeks.filter((w) => w.plan_id === plan.id);
    const closed = mine.filter((w) => w.closed_at);
    const saved = closed.reduce((sum, w) => sum + (w.saved_amount ?? 0), 0);
    const targetTotal = plannedTotal(plan);
    return {
      id: plan.id,
      name: plan.name,
      starts_on: plan.starts_on,
      ends_on: plan.ends_on,
      weekly_target: plan.weekly_target,
      horizon_months: plan.horizon_months,
      total_weeks: weeksOf(plan),
      weeks_opened: mine.length,
      weeks_closed: closed.length,
      saved,
      target_total: targetTotal,
      percent: targetTotal > 0 ? Math.round((saved / targetTotal) * 100) : 0,
      met: saved >= targetTotal,
      finished: plan.ends_on < today,
      notes: plan.notes,
    };
  });

  const current = results.find((r) => r.id === running?.id) ?? null;
  const history = results.filter((r) => r.id !== running?.id);
  const progress = running ? await planProgress(org.id, running, today) : null;

  const owed = loans.reduce((sum, l) => sum + l.balance, 0);
  const weekly = loans
    .filter((l) => l.balance > 0)
    .reduce((sum, l) => sum + l.weekly_payment, 0);
  const weeksToClear = weekly > 0 ? Math.ceil(owed / weekly) : null;

  return (
    <div className="max-w-5xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Plan
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            What you intend to save, and how it is going.
          </p>
        </div>
        {progress && progress.running && (
          <div className="flex flex-wrap gap-3">
            <Stat label="Saved" value={aud(progress.saved)} tone="in" />
            <Stat label="Of" value={aud(progress.target_total)} />
            <Stat
              label={progress.ahead_by >= 0 ? "Ahead by" : "Behind by"}
              value={aud(Math.abs(progress.ahead_by))}
              tone={progress.ahead_by >= 0 ? "in" : "bad"}
            />
          </div>
        )}
      </div>

      {/* The order of operations, stated once and in plain words, because the
          whole plan depends on it: the loans come out first. */}
      <section
        className={`rounded-2xl p-6 ring-1 ${
          owed > 0
            ? "bg-amber-50 ring-amber-200 dark:bg-amber-950/30 dark:ring-amber-900"
            : "bg-emerald-50 ring-emerald-200 dark:bg-emerald-950/30 dark:ring-emerald-900"
        }`}
      >
        {owed > 0 ? (
          <>
            <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              First goal: clear the loans
            </h2>
            <p className="mt-1 text-sm text-amber-900/80 dark:text-amber-200/80">
              <span className="font-semibold">{aud(owed)}</span> still owed,{" "}
              {aud(weekly)} a week
              {weeksToClear !== null && (
                <>
                  , about {weeksToClear}{" "}
                  {weeksToClear === 1 ? "week" : "weeks"} to go
                </>
              )}
              . Saving starts once this is gone.{" "}
              <Link href="/savings/loans" className="font-semibold underline">
                Loans
              </Link>
            </p>
          </>
        ) : (
          <>
            <h2 className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
              No loans outstanding
            </h2>
            <p className="mt-1 text-sm text-emerald-900/80 dark:text-emerald-200/80">
              Nothing to clear first. Pick the day week 1 starts and the plan is
              running.
            </p>
          </>
        )}
      </section>

      <PlanPanel current={current} history={history} today={today} />

      {progress && (
        <>
          <Milestones progress={progress} />
          <Months progress={progress} />
        </>
      )}
    </div>
  );
}

/**
 * The horizons a long plan is actually read at.
 *
 * A two-year figure is impossible to feel. A month is not: either this month is
 * on track or it is not, and four of those in a row is where six months comes
 * from. Each one is cumulative from the start, so they nest rather than compete.
 */
function Milestones({
  progress,
}: {
  progress: Awaited<ReturnType<typeof planProgress>>;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Milestones
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Week {progress.current_week} of {progress.total_weeks}
          {progress.ends_on && ` · ends ${progress.ends_on}`}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {progress.milestones.map((m) => {
          const pct = Math.max(0, Math.min(100, m.percent));
          const onTrack = m.saved >= m.due_so_far;
          return (
            <div
              key={m.key}
              className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {m.label}
                </p>
                <span
                  className={`text-xs font-semibold ${
                    m.reached
                      ? "text-emerald-600 dark:text-emerald-400"
                      : onTrack
                        ? "text-slate-500 dark:text-slate-400"
                        : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {pct}%
                </span>
              </div>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                by {m.ends_on}
              </p>

              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div
                  className={`h-full rounded-full ${
                    m.reached
                      ? "bg-emerald-500"
                      : onTrack
                        ? "bg-sky-500"
                        : "bg-red-500"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>

              <p className="mt-2 text-sm font-bold text-slate-900 dark:text-slate-100">
                {aud(m.saved)}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                of {aud(m.target)}
                {m.in_future && (
                  <>
                    {" "}
                    ·{" "}
                    <span
                      className={
                        onTrack
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400"
                      }
                    >
                      {onTrack ? "on track" : `${aud(m.due_so_far - m.saved)} behind`}
                    </span>
                  </>
                )}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Months({
  progress,
}: {
  progress: Awaited<ReturnType<typeof planProgress>>;
}) {
  if (progress.by_month.length === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        No week has been closed yet, so there is nothing to show by month. A
        week counts here the moment it closes.
      </p>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Month by month
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {progress.weeks_won} weeks over · {progress.weeks_even} level ·{" "}
          {progress.weeks_lost} under
        </p>
      </div>

      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3 font-medium">Month</th>
              <th className="px-4 py-3 font-medium">Weeks</th>
              <th className="px-4 py-3 text-right font-medium">Target</th>
              <th className="px-4 py-3 text-right font-medium">Saved</th>
              <th className="px-4 py-3 text-right font-medium">Against</th>
              <th className="px-4 py-3 text-right font-medium">Of target</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {progress.by_month.map((m) => {
              const against = m.saved - m.target;
              const pct =
                m.target > 0 ? Math.round((m.saved / m.target) * 100) : 0;
              return (
                <tr key={m.month}>
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                    {monthLabel(m.month)}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                    {m.weeks}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-500 dark:text-slate-400">
                    {aud(m.target)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900 dark:text-slate-100">
                    {aud(m.saved)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right ${
                      against < 0
                        ? "text-red-600 dark:text-red-400"
                        : "text-emerald-600 dark:text-emerald-400"
                    }`}
                  >
                    {against >= 0 ? "+" : ""}
                    {aud(against)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        pct >= 100
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                          : pct >= 80
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                            : "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300"
                      }`}
                    >
                      {pct}%
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function monthLabel(month: string) {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-AU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
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
