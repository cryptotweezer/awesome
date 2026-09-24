import { awesomeForPage } from "@/lib/data/org";
import {
  listDeletedPlans,
  listPlans,
  planInFocus,
  plannedTotal,
  weeksOf,
} from "@/lib/data/savings-plan";
import { milestonesFor, planProgress } from "@/lib/data/savings-progress";
import { todayInSydney } from "@/lib/format";
import { aud } from "@/lib/savings";
import { vaultOutflows } from "@/lib/data/vault";
import { listWeeks } from "@/lib/data/weeks";
import { MilestoneCards } from "./milestones";
import { DeletedPlans } from "./deleted-plans";
import { PlanHistory, PlanPanel, type PlanResult } from "./plan-form";

export default async function SavingsPlanPage() {
  const org = await awesomeForPage();
  const today = todayInSydney();

  const [plans, weeks, outflows, binned] = await Promise.all([
    listPlans(org.id),
    // Read, never ensured: this page describes the plans, and opening weeks is
    // the overview's job.
    listWeeks(org.id),
    // What has left the vault, so a plan can show what it saved AND KEPT.
    vaultOutflows(org.id),
    // Deleted plans still inside their thirty days.
    listDeletedPlans(org.id),
  ]);

  // What the top of the page shows: the plan running today, or the last one
  // that finished and has not been filed away yet. A plan does not leave the
  // screen because a date passed; its last weeks are usually still open.
  const focus = await planInFocus(org.id, today);

  // Each plan's result, from its own weeks. The figures of a closed week were
  // frozen as it closed, so a finished plan's result cannot move afterwards.
  const results: PlanResult[] = plans.map((plan) => {
    const mine = weeks.filter((w) => w.plan_id === plan.id);
    const closed = mine.filter((w) => w.closed_at);
    const saved = closed.reduce((sum, w) => sum + (w.saved_amount ?? 0), 0);
    const targetTotal = plannedTotal(plan);

    // Money that left the vault while this plan was running. A transfer to
    // Vault COL is not in `outflows`: that money is still saved, only frozen.
    const until = plan.ends_on < today ? plan.ends_on : today;
    const takenOut = outflows
      .filter((o) => o.on >= plan.starts_on && o.on <= until)
      .reduce((sum, o) => sum + o.amount, 0);
    const netSaved = Math.round((saved - takenOut) * 100) / 100;

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
      taken_out: Math.round(takenOut * 100) / 100,
      net_saved: netSaved,
      target_total: targetTotal,
      percent: targetTotal > 0 ? Math.round((netSaved / targetTotal) * 100) : 0,
      met: netSaved >= targetTotal,
      finished: plan.ends_on < today,
      archived: plan.archived_at !== null,
      notes: plan.notes,
      // Its own stretches, from the weeks already in hand. No extra query, and
      // the history can draw the same cards as the plan on screen.
      milestones: milestonesFor(
        plan,
        closed.map((w) => ({
          week_start: w.week_start,
          saved: w.saved_amount ?? 0,
          target: w.target_amount ?? plan.weekly_target,
        })),
        today,
      ),
      // Newest first, the way every other list of weeks in the app reads.
      weeks: mine
        .slice()
        .sort((a, b) => b.week_start.localeCompare(a.week_start))
        .map((w) => ({
          id: w.id,
          week_start: w.week_start,
          week_end: w.week_end,
          closed: Boolean(w.closed_at),
          saved: w.closed_at ? (w.saved_amount ?? 0) : null,
          // Its own frozen target if it has one, else what the plan asks for.
          target: w.target_amount ?? plan.weekly_target,
        })),
    };
  });

  const current = results.find((r) => r.id === focus?.id) ?? null;
  const history = results.filter((r) => r.id !== focus?.id);
  // The milestones belong to the plan the weeks are being judged against, so
  // they are read from the running plan, or from the finished one still on
  // screen, which is the same row in both cases.
  const progress = focus ? await planProgress(org.id, focus, today) : null;

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
            <Stat label="Saved" value={aud(progress.net_saved)} tone="in" />
            <Stat label="Of" value={aud(progress.target_total)} />
            <Stat
              label={progress.ahead_by >= 0 ? "Ahead by" : "Behind by"}
              value={aud(Math.abs(progress.ahead_by))}
              tone={progress.ahead_by >= 0 ? "in" : "bad"}
            />
          </div>
        )}
      </div>

      <PlanPanel current={current} history={history} today={today} />

      {progress && <Milestones progress={progress} />}

      {/* The plan running now is what the page is for; the ones before it are a
          record, and a record sitting between the plan and its own milestones
          reads as an interruption. The tally of all of them comes last, because
          it is the conclusion of the list above it. */}
      {history.length > 0 && <PlanHistory rows={history} />}

      {binned.length > 0 && <DeletedPlans rows={binned} today={today} />}

      <AllPlans rows={results} />
    </div>
  );
}

/**
 * The stretches a plan is read at, which come from its own length.
 *
 * A two-year figure is impossible to feel. A month is not: either that month was
 * on track or it was not. A one-month plan is cut into its weeks instead,
 * because "the first month" would be the whole plan.
 *
 * Each card measures ITS OWN stretch and nothing before it, which is the whole
 * point: cumulative bars had week 4 sitting at 25 per cent because week 1 had
 * closed, before week 4 had begun. A stretch that has not started reads zero.
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

      <MilestoneCards milestones={progress.milestones} />
    </section>
  );
}

/**
 * Every plan ever run, in three numbers.
 *
 * A plan on its own answers "did I make that one". This answers the question
 * underneath it, which is the one worth asking after a year of them: of all the
 * plans that have finished, how many did I actually make, and how much of
 * everything I set out to save did I save.
 *
 * Only finished plans count. A plan still running has not failed, it has not
 * happened yet, and counting it would drag the figure down every time a new one
 * starts.
 */
function AllPlans({ rows }: { rows: PlanResult[] }) {
  const done = rows.filter((r) => r.finished);
  if (done.length < 1) return null;

  const met = done.filter((r) => r.met).length;
  const saved = done.reduce((sum, r) => sum + r.net_saved, 0);
  const asked = done.reduce((sum, r) => sum + r.target_total, 0);
  const rate = Math.round((met / done.length) * 100);
  const ofMoney = asked > 0 ? Math.round((saved / asked) * 100) : 0;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
        Every plan so far
      </h2>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card
          label="Plans finished"
          value={String(done.length)}
          note={`${met} made it · ${done.length - met} did not`}
        />
        <Card
          label="Made the target"
          value={`${rate}%`}
          tone={rate >= 100 ? "in" : rate >= 50 ? "plain" : "bad"}
          note="of the plans that have finished"
        />
        <Card
          label="Of everything planned"
          value={`${ofMoney}%`}
          tone={ofMoney >= 100 ? "in" : "plain"}
          note={`${aud(saved)} saved of ${aud(asked)}`}
        />
      </div>
    </section>
  );
}

function Card({
  label,
  value,
  note,
  tone = "plain",
}: {
  label: string;
  value: string;
  note: string;
  tone?: keyof typeof TONES;
}) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-bold ${TONES[tone]}`}>{value}</p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{note}</p>
    </div>
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
