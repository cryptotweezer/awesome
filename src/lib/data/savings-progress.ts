import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayInSydney } from "@/lib/format";
import { addDays, daysBetween } from "@/lib/data/weeks";
import type { SavingsPlan } from "@/lib/types";

/**
 * How the plan is going, at the four horizons that matter.
 *
 * The weekly amount is the only number that is stored. Everything below is
 * worked out from it and from the weeks that actually closed, so there is one
 * thing to edit and never three that disagree.
 *
 * The milestones are cumulative and they are read the same way: at this point
 * in the plan you should have put away X, you have put away Y, that is Z per
 * cent. A milestone still in the future says what it will ask for, which is the
 * question a long plan is actually for.
 */

export type Milestone = {
  key: string;
  label: string;
  /** Last day of the stretch this milestone covers. */
  ends_on: string;
  weeks: number;
  /** What should be saved by then. */
  target: number;
  /** What has actually been saved so far inside it. */
  saved: number;
  /** Of the target, how much is due by TODAY. Equals `target` once it has ended. */
  due_so_far: number;
  percent: number;
  reached: boolean;
  in_future: boolean;
};

export type PlanProgress = {
  plan: SavingsPlan;
  /** Today falls inside the plan's dates. */
  running: boolean;
  /** Its last week has gone by: the result is final. */
  finished: boolean;
  /** Did it reach the total it set out to save. */
  met: boolean;
  /** Which week of the plan today falls in. 0 before it starts. */
  current_week: number;
  total_weeks: number;
  ends_on: string;
  /** Everything saved in closed weeks since the plan started. */
  saved: number;
  /** What the plan asks for by today. */
  due_so_far: number;
  /** saved - due_so_far. Negative is what the plan is owed. */
  ahead_by: number;
  target_total: number;
  percent: number;
  weeks_closed: number;
  weeks_won: number;
  weeks_lost: number;
  weeks_even: number;
  /** Saved per calendar month, newest first. */
  by_month: { month: string; saved: number; target: number; weeks: number }[];
  milestones: Milestone[];
};

const num = (v: unknown) => Number(v ?? 0);

function monthsOf(startsOn: string, months: number): string {
  // Calendar months from the start date, which is what "6 months in" means to
  // a person. Day-of-month is clamped so the 31st does not skip February.
  const [y, m, d] = startsOn.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  // The stretch ends the day before the anniversary.
  return addDays(target.toISOString().slice(0, 10), -1);
}

export async function planProgress(
  orgId: string,
  plan: SavingsPlan,
  today = todayInSydney(),
): Promise<PlanProgress> {
  const supabase = createAdminClient();

  // This plan's weeks and nobody else's. Before plans had an identity the only
  // way to tell was the start date, which cannot separate one plan from the
  // next once there are several.
  const { data, error } = await supabase
    .from("savings_weeks")
    .select("week_start, saved_amount, target_amount, closed_at")
    .eq("org_id", orgId)
    .eq("plan_id", plan.id)
    .not("closed_at", "is", null)
    .order("week_start");
  if (error) throw new Error(`Failed to read the weeks: ${error.message}`);

  const startsOn = plan.starts_on;
  const closed = (data ?? []).map((r) => ({
    week_start: r.week_start as string,
    saved: num(r.saved_amount),
    target: num(r.target_amount),
  }));

  const totalWeeks = Math.round((plan.horizon_months / 12) * 52);
  const saved = closed.reduce((s, w) => s + w.saved, 0);

  const elapsed = Math.max(
    0,
    Math.min(totalWeeks, Math.floor(daysBetween(startsOn, today) / 7)),
  );
  const currentWeek = Math.min(totalWeeks, elapsed + 1);
  const endsOn = plan.ends_on;
  const targetTotal = plan.weekly_target * totalWeeks;
  const dueSoFar = plan.weekly_target * elapsed;

  const byMonthMap = new Map<
    string,
    { saved: number; target: number; weeks: number }
  >();
  let won = 0;
  let lost = 0;
  let even = 0;
  for (const w of closed) {
    const month = w.week_start.slice(0, 7);
    const row = byMonthMap.get(month) ?? { saved: 0, target: 0, weeks: 0 };
    row.saved += w.saved;
    row.target += w.target;
    row.weeks += 1;
    byMonthMap.set(month, row);

    const diff = w.saved - w.target;
    if (Math.abs(diff) < 0.005) even += 1;
    else if (diff > 0) won += 1;
    else lost += 1;
  }

  // The horizons a long plan is actually read at.
  const steps: { key: string; label: string; months: number }[] = [
    { key: "m1", label: "First month", months: 1 },
    { key: "m6", label: "6 months", months: 6 },
    { key: "m12", label: "1 year", months: 12 },
    { key: "m24", label: "2 years", months: 24 },
  ];
  if (!steps.some((s) => s.months === plan.horizon_months)) {
    steps.push({
      key: "full",
      label: `Full plan (${plan.horizon_months} months)`,
      months: plan.horizon_months,
    });
  }

  const milestones: Milestone[] = steps
    .filter((s) => s.months <= plan.horizon_months)
    .map((s) => {
      const endsAt = monthsOf(startsOn, s.months);
      const weeks = Math.max(
        1,
        Math.round(Math.min(daysBetween(startsOn, endsAt) + 1, s.months * 30.44 + 1) / 7),
      );
      const target = plan.weekly_target * weeks;
      const savedInside = closed
        .filter((w) => w.week_start <= endsAt)
        .reduce((sum, w) => sum + w.saved, 0);
      const elapsedInside = Math.max(
        0,
        Math.min(weeks, Math.floor(daysBetween(startsOn, today) / 7)),
      );
      const due = plan.weekly_target * elapsedInside;
      return {
        key: s.key,
        label: s.label,
        ends_on: endsAt,
        weeks,
        target,
        saved: savedInside,
        due_so_far: due,
        percent: target > 0 ? Math.round((savedInside / target) * 100) : 0,
        reached: savedInside >= target,
        in_future: endsAt > today,
      };
    });

  return {
    plan,
    // Still inside its dates. A finished plan is read the same way, it just
    // has nothing left to ask for.
    running: startsOn <= today && plan.ends_on >= today,
    finished: plan.ends_on < today,
    met: saved >= plan.weekly_target * totalWeeks,
    current_week: currentWeek,
    total_weeks: totalWeeks,
    ends_on: endsOn,
    saved,
    due_so_far: dueSoFar,
    ahead_by: saved - dueSoFar,
    target_total: targetTotal,
    percent: targetTotal > 0 ? Math.round((saved / targetTotal) * 100) : 0,
    weeks_closed: closed.length,
    weeks_won: won,
    weeks_lost: lost,
    weeks_even: even,
    by_month: [...byMonthMap.entries()]
      .map(([month, v]) => ({ month, ...v }))
      .sort((a, b) => b.month.localeCompare(a.month)),
    milestones,
  };
}
