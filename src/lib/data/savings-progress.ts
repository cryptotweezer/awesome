import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayInSydney } from "@/lib/format";
import { addDays, daysBetween } from "@/lib/data/weeks";
import type { SavingsPlan } from "@/lib/types";

/**
 * How the plan is going, at the horizons its own length gives it.
 *
 * The weekly amount is the only number that is stored. Everything below is
 * worked out from it and from the weeks that actually closed, so there is one
 * thing to edit and never three that disagree.
 *
 * A milestone measures ITS OWN stretch and nothing before it. Cumulative was
 * worse than wrong, it was misleading: in a four-week plan, week 1 closing put
 * week 4 at 25 per cent before week 4 had begun. Each one now answers "how did
 * that week go" or "how did that month go", and a stretch that has not started
 * yet reads zero, which is the truth.
 *
 * A one-month plan is cut into its weeks; anything longer into months, with
 * every sixth month and the last one read louder.
 */

export type Milestone = {
  key: string;
  label: string;
  /** First day of the stretch this milestone covers. */
  starts_on: string;
  /** Last day of it. */
  ends_on: string;
  /** A six-month mark, or the end of a short plan: read louder than the rest. */
  major: boolean;
  /** Weeks inside this stretch alone. */
  weeks: number;
  /** What this stretch asks for: the weekly amount times its own weeks. */
  target: number;
  /** What the weeks INSIDE it saved. Nothing from before it counts. */
  saved: number;
  /** Of its target, how much is due by today. Equals `target` once it has ended. */
  due_so_far: number;
  percent: number;
  reached: boolean;
  /** It has not begun yet, so it reads zero rather than behind. */
  not_started: boolean;
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
  /**
   * What has left the vault while this plan was running: withdrawals and loan
   * payments funded by a vault. Money sent to Vault COL is NOT here, because it
   * is still saved, only frozen.
   */
  taken_out: number;
  /** saved - taken_out. What the plan has actually put away and kept. */
  net_saved: number;
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

/** One closed week, reduced to what a milestone needs from it. */
export type ClosedWeek = { week_start: string; saved: number; target: number };

/**
 * The stretches a plan is read at, worked out from the plan and its closed
 * weeks alone.
 *
 * Pure on purpose: the Plan page draws these for the plan running now AND for
 * every plan in the history, and it already holds their weeks. A function that
 * went back to the database for each one would turn a page into a queue.
 */
export function milestonesFor(
  plan: SavingsPlan,
  closed: ClosedWeek[],
  today = todayInSydney(),
): Milestone[] {
  const startsOn = plan.starts_on;
  const totalWeeks = Math.round((plan.horizon_months / 12) * 52);

  // The stretches this plan is read at, which come from its own length rather
  // than from a fixed list. A one-month plan is four weeks and is read weekly:
  // "the first month" is the whole thing and says nothing. Anything longer is
  // read monthly, because a month is the shortest stretch a person can feel,
  // and every sixth month is drawn louder so a long plan still has a few big
  // moments in it instead of twenty-four identical ones.
  const weekly = plan.horizon_months <= 1;

  const steps: {
    key: string;
    label: string;
    startsAt: string;
    endsAt: string;
    major: boolean;
  }[] = [];

  if (weekly) {
    for (let i = 0; i < totalWeeks; i += 1) {
      steps.push({
        key: `w${i + 1}`,
        label: `Week ${i + 1}`,
        startsAt: addDays(startsOn, i * 7),
        endsAt: addDays(startsOn, (i + 1) * 7 - 1),
        major: i + 1 === totalWeeks,
      });
    }
  } else {
    let from = startsOn;
    for (let i = 1; i <= plan.horizon_months; i += 1) {
      const endsAt = monthsOf(startsOn, i);
      const major = i % 6 === 0 || i === plan.horizon_months;
      steps.push({
        key: `m${i}`,
        label:
          i % 12 === 0
            ? i === 12
              ? "1 year"
              : `${i / 12} years`
            : major
              ? `${i} months`
              : `Month ${i}`,
        startsAt: from,
        endsAt,
        major,
      });
      from = addDays(endsAt, 1);
    }
  }

  const milestones: Milestone[] = steps.map((step) => {
    // Never past the plan's own last day: the final stretch IS the plan's end.
    const endsAt = step.endsAt > plan.ends_on ? plan.ends_on : step.endsAt;
    const weeks = Math.max(
      1,
      Math.round((daysBetween(step.startsAt, endsAt) + 1) / 7),
    );
    const target = plan.weekly_target * weeks;

    // Only the weeks that belong to THIS stretch. A week is placed by the day
    // it started, the same way the month table used to group them.
    const inside = closed.filter(
      (w) => w.week_start >= step.startsAt && w.week_start <= endsAt,
    );
    const savedInside = inside.reduce((sum, w) => sum + w.saved, 0);

    // How much of its own target is due by today: nothing before it starts, all
    // of it once it has ended, and a week at a time in between.
    const weeksGoneBy =
      today < step.startsAt
        ? 0
        : Math.max(
            0,
            Math.min(weeks, Math.floor(daysBetween(step.startsAt, today) / 7)),
          );

    return {
      key: step.key,
      label: step.label,
      starts_on: step.startsAt,
      ends_on: endsAt,
      major: step.major,
      weeks,
      target,
      saved: savedInside,
      due_so_far: plan.weekly_target * weeksGoneBy,
      percent: target > 0 ? Math.round((savedInside / target) * 100) : 0,
      reached: savedInside >= target,
      not_started: step.startsAt > today,
      in_future: endsAt > today,
    };
  });

  return milestones;
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

  // How each closed week went against its own target, which is what "three
  // weeks under" means on the overview.
  let won = 0;
  let lost = 0;
  let even = 0;
  for (const w of closed) {
    const diff = w.saved - w.target;
    if (Math.abs(diff) < 0.005) even += 1;
    else if (diff > 0) won += 1;
    else lost += 1;
  }

  const milestones = milestonesFor(plan, closed, today);

  // What has left the vault while this plan was running. A transfer to Vault
  // COL is not here: that money is still saved, it has only stopped being
  // reachable. A withdrawal and a loan paid out of a vault really are gone.
  const until = plan.ends_on < today ? plan.ends_on : today;
  const [withdrawals, vaultLoanPayments] = await Promise.all([
    supabase
      .from("vault_movements")
      .select("amount")
      .eq("org_id", orgId)
      .eq("kind", "withdrawal")
      .gte("occurred_on", startsOn)
      .lte("occurred_on", until),
    supabase
      .from("loan_payments")
      .select("amount")
      .eq("org_id", orgId)
      .not("from_vault", "is", null)
      .gte("paid_on", startsOn)
      .lte("paid_on", until),
  ]);
  const takenOut =
    (withdrawals.data ?? []).reduce((sum, r) => sum + num(r.amount), 0) +
    (vaultLoanPayments.data ?? []).reduce((sum, r) => sum + num(r.amount), 0);
  const netSaved = Math.round((saved - takenOut) * 100) / 100;

  return {
    plan,
    // Still inside its dates. A finished plan is read the same way, it just
    // has nothing left to ask for.
    running: startsOn <= today && plan.ends_on >= today,
    finished: plan.ends_on < today,
    met: netSaved >= plan.weekly_target * totalWeeks,
    current_week: currentWeek,
    total_weeks: totalWeeks,
    ends_on: endsOn,
    saved,
    taken_out: Math.round(takenOut * 100) / 100,
    net_saved: netSaved,
    due_so_far: dueSoFar,
    // Read against what was kept, not against what was put away and taken back
    // out again: the plan is owed the difference either way.
    ahead_by: netSaved - dueSoFar,
    target_total: targetTotal,
    percent: targetTotal > 0 ? Math.round((netSaved / targetTotal) * 100) : 0,
    weeks_closed: closed.length,
    weeks_won: won,
    weeks_lost: lost,
    weeks_even: even,
    milestones,
  };
}
