import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayInSydney } from "@/lib/format";
import { vaultStatus } from "@/lib/data/vault";
import type { SavingsPlan } from "@/lib/types";

/**
 * Savings plans, one after another.
 *
 * A business runs one plan at a time and keeps every plan it has run. That is
 * the whole point of having more than one: a two-year plan is hard to believe
 * in, three six-month plans are not, and "did I make the last one" is the
 * question this section exists to answer.
 *
 * Two rules hold the model together, and both are about not having two answers
 * to the same question:
 *
 *   * plans never overlap. A week belongs to one plan, so a new plan starts
 *     after the previous one ends. `startPlan` refuses anything else.
 *   * finished is derived from the date, never stored. A plan is running while
 *     `ends_on` is still ahead, the same way an invoice is overdue only
 *     because of today's date. Its result cannot drift either: each of its
 *     weeks froze its own figures as it closed.
 *
 * `ends_on` is a generated column, so the arithmetic that turns a horizon in
 * months into a last date lives in the database and cannot disagree with a
 * copy of it in here.
 */

const num = (v: unknown) => Number(v ?? 0);

function normalise(row: Record<string, unknown>): SavingsPlan {
  return {
    ...(row as unknown as SavingsPlan),
    weekly_target: num(row.weekly_target),
  };
}

/** Every plan this business has run, newest first. */
export async function listPlans(orgId: string): Promise<SavingsPlan[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("savings_plans")
    .select("*")
    .eq("org_id", orgId)
    .order("starts_on", { ascending: false });
  if (error) throw new Error(`Failed to load the plans: ${error.message}`);
  return (data ?? []).map(normalise);
}

/**
 * The plan running today, or null.
 *
 * Null is a real answer and the reason nothing is created on read any more: a
 * business between plans has no plan, and inventing a blank one would put an
 * empty plan back on screen the moment the last one finished.
 *
 * This is the one every week is judged against, so it is strictly about dates
 * and knows nothing about archiving.
 */
export async function currentPlan(
  orgId: string,
  today = todayInSydney(),
): Promise<SavingsPlan | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("savings_plans")
    .select("*")
    .eq("org_id", orgId)
    .gte("ends_on", today)
    .order("starts_on", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to load the plan: ${error.message}`);
  return data ? normalise(data) : null;
}

/**
 * The plan the Plan page puts at the top.
 *
 * The one running, and when there is none, the last one that finished and has
 * not been filed away yet. A plan does not leave the top of the screen because
 * a date passed: its last weeks are usually still open, waiting on money, and
 * the result is not final until they close. The owner files it away, and only
 * then does the page offer to start the next one.
 */
export async function planInFocus(
  orgId: string,
  today = todayInSydney(),
): Promise<SavingsPlan | null> {
  const running = await currentPlan(orgId, today);
  if (running) return running;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("savings_plans")
    .select("*")
    .eq("org_id", orgId)
    .is("archived_at", null)
    .order("starts_on", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to load the plan: ${error.message}`);
  return data ? normalise(data) : null;
}

/** One plan of this business, by id. */
export async function getPlan(
  orgId: string,
  id: string,
): Promise<SavingsPlan | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("savings_plans")
    .select("*")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load the plan: ${error.message}`);
  return data ? normalise(data) : null;
}

/** The plan a date falls inside, which is the plan the week belongs to. */
export async function planOn(
  orgId: string,
  date: string,
): Promise<SavingsPlan | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("savings_plans")
    .select("*")
    .eq("org_id", orgId)
    .lte("starts_on", date)
    .gte("ends_on", date)
    .maybeSingle();
  if (error) throw new Error(`Failed to load the plan: ${error.message}`);
  return data ? normalise(data) : null;
}

export type NewPlan = {
  name?: string | null;
  starts_on: string;
  weekly_target: number;
  horizon_months: number;
  notes?: string | null;
};

/**
 * Start a plan.
 *
 * Refused if it would overlap one that already exists, because a week cannot
 * belong to two plans and the overlap would be invisible afterwards: the weeks
 * would simply attach to whichever plan was found first.
 */
export async function startPlan(
  orgId: string,
  input: NewPlan,
): Promise<SavingsPlan> {
  const supabase = createAdminClient();

  const clash = await overlapping(orgId, input.starts_on, input.horizon_months);
  if (clash) {
    throw new Error(
      `That overlaps the plan from ${clash.starts_on} to ${clash.ends_on}. ` +
        `A new plan starts after the last one ends, even if that one is filed away.`,
    );
  }

  const { data, error } = await supabase
    .from("savings_plans")
    .insert({
      org_id: orgId,
      name: input.name ?? null,
      starts_on: input.starts_on,
      weekly_target: input.weekly_target,
      horizon_months: input.horizon_months,
      notes: input.notes ?? null,
    })
    .select("*")
    .single();
  if (error) throw new Error(`Failed to start the plan: ${error.message}`);
  return normalise(data);
}

export type PlanPatch = {
  name?: string | null;
  starts_on?: string;
  weekly_target?: number;
  horizon_months?: number;
  notes?: string | null;
};

/**
 * Change a plan.
 *
 * Moving its dates is checked against the other plans for the same reason
 * starting one is. Weeks already opened under it keep their `plan_id`: a week
 * that falls outside the new dates stops counting towards the plan's figures
 * but is not deleted, because what happened in it still happened.
 */
export async function updatePlan(
  orgId: string,
  id: string,
  patch: PlanPatch,
): Promise<SavingsPlan> {
  const supabase = createAdminClient();
  const plan = await getPlan(orgId, id);
  if (!plan) throw new Error("Plan not found");

  const startsOn = patch.starts_on ?? plan.starts_on;
  const horizon = patch.horizon_months ?? plan.horizon_months;
  if (startsOn !== plan.starts_on || horizon !== plan.horizon_months) {
    const clash = await overlapping(orgId, startsOn, horizon, id);
    if (clash) {
      throw new Error(
        `That would overlap the plan from ${clash.starts_on} to ${clash.ends_on}.`,
      );
    }
  }

  const { data, error } = await supabase
    .from("savings_plans")
    .update(patch)
    .eq("org_id", orgId)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`Failed to save the plan: ${error.message}`);
  return normalise(data);
}

/**
 * File a finished plan away, or take it back out.
 *
 * Only a plan whose last date has gone by: archiving one that is still running
 * would hide the thing every week is being judged against. A plan that is
 * finished but not archived stays in the top slot on purpose, because its last
 * weeks are usually still open with money on the way.
 */
export async function archivePlan(
  orgId: string,
  id: string,
  archived: boolean,
  today = todayInSydney(),
): Promise<SavingsPlan> {
  const plan = await getPlan(orgId, id);
  if (!plan) throw new Error("Plan not found");
  if (archived && plan.ends_on >= today) {
    throw new Error(
      `That plan runs until ${plan.ends_on}. Finish it first, or change its dates.`,
    );
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("savings_plans")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("org_id", orgId)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`Failed to archive the plan: ${error.message}`);
  return normalise(data);
}

/**
 * What deleting a plan would take with it.
 *
 * The vault holds no balance of its own: Vault AUS is the sum of what the
 * closed weeks confirmed, less what has left it. So deleting a plan deletes its
 * weeks and the vault falls by everything they had saved, quietly and with
 * nothing to point at afterwards. This is what the screen has to say out loud
 * BEFORE the button is pressed.
 */
export async function deletePlanImpact(
  orgId: string,
  id: string,
): Promise<{ weeks: number; closed: number; saved: number }> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("savings_weeks")
    .select("closed_at, saved_amount")
    .eq("org_id", orgId)
    .eq("plan_id", id);
  if (error) throw new Error(`Failed to read the weeks: ${error.message}`);

  const rows = data ?? [];
  return {
    weeks: rows.length,
    closed: rows.filter((w) => w.closed_at).length,
    saved: rows.reduce((sum, w) => sum + num(w.saved_amount), 0),
  };
}

/**
 * Delete a plan, and every week that was run under it.
 *
 * The weeks go by cascade, and with them the record of what was done each day,
 * what was paid and what each week cost, AND the part of the vault they had
 * filled. Nothing on the billing side moves: the only link between the two
 * halves points from a week's line TO an invoice, never back, so the documents
 * outlive the record of the days they were for. Clients, the rotation, the
 * fixed costs and the loans are not part of a plan at all.
 *
 * One thing is refused rather than confirmed: a delete that would leave a vault
 * holding less than nothing. If 4,000 was saved and 3,000 of it has already
 * been sent to Colombia, deleting the weeks that saved it leaves the vault at
 * minus 3,000, which is not a state the money can be in. That is always a
 * mistake, so it takes `force` and a person who means it.
 */
export async function deletePlan(
  orgId: string,
  id: string,
  opts: { force?: boolean; by?: string | null } = {},
): Promise<{ weeks: number; saved: number }> {
  const supabase = createAdminClient();
  const impact = await deletePlanImpact(orgId, id);

  if (!opts.force && impact.saved > 0) {
    const vault = await vaultStatus(orgId);
    const after = Math.round((vault.aus - impact.saved) * 100) / 100;
    if (after < -0.005) {
      throw new Error(
        `Those weeks put ${impact.saved.toFixed(2)} into Vault AUS, which holds ` +
          `${vault.aus.toFixed(2)}. Deleting them would leave it at ${after.toFixed(2)}, ` +
          `because money has already been sent or spent out of it. Tick the second box if ` +
          `that is really what you want.`,
      );
    }
  }

  // Copied aside before it goes, so a mis-click has thirty days to be undone.
  // The copy is the whole thing: the plan, its weeks, the work recorded on them
  // and what they cost. See `deleted_plans` for why a copy and not a flag.
  const plan = await getPlan(orgId, id);
  if (!plan) throw new Error("Plan not found");

  const { data: weeks } = await supabase
    .from("savings_weeks")
    .select("*")
    .eq("org_id", orgId)
    .eq("plan_id", id);
  const weekIds = (weeks ?? []).map((w) => w.id as string);

  const [entries, expenses] = await Promise.all([
    weekIds.length > 0
      ? supabase
          .from("week_entries")
          .select("*")
          .eq("org_id", orgId)
          .in("week_id", weekIds)
      : Promise.resolve({ data: [] as unknown[] }),
    weekIds.length > 0
      ? supabase
          .from("week_expenses")
          .select("*")
          .eq("org_id", orgId)
          .in("week_id", weekIds)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const { error: binError } = await supabase.from("deleted_plans").upsert(
    {
      org_id: orgId,
      plan_id: id,
      name: plan.name,
      starts_on: plan.starts_on,
      ends_on: plan.ends_on,
      weeks: impact.weeks,
      saved: impact.saved,
      deleted_at: new Date().toISOString(),
      deleted_by: opts.by ?? null,
      payload: {
        plan,
        weeks: weeks ?? [],
        entries: entries.data ?? [],
        expenses: expenses.data ?? [],
      },
    },
    { onConflict: "org_id,plan_id" },
  );
  if (binError) {
    throw new Error(`Failed to put the plan aside: ${binError.message}`);
  }

  const { error } = await supabase
    .from("savings_plans")
    .delete()
    .eq("org_id", orgId)
    .eq("id", id);
  if (error) throw new Error(`Failed to delete the plan: ${error.message}`);

  return { weeks: impact.weeks, saved: impact.saved };
}

/** A plan waiting in the bin, and what it holds. */
export type DeletedPlan = {
  id: string;
  plan_id: string;
  name: string | null;
  starts_on: string;
  ends_on: string;
  weeks: number;
  saved: number;
  deleted_at: string;
  deleted_by: string | null;
};

/** What is still recoverable, newest first. */
export async function listDeletedPlans(
  orgId: string,
): Promise<DeletedPlan[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("deleted_plans")
    .select("id, plan_id, name, starts_on, ends_on, weeks, saved, deleted_at, deleted_by")
    .eq("org_id", orgId)
    .order("deleted_at", { ascending: false });
  if (error) throw new Error(`Failed to read the bin: ${error.message}`);
  return (data ?? []).map((r) => ({
    ...(r as unknown as DeletedPlan),
    saved: num(r.saved),
  }));
}

/**
 * Put a deleted plan back, exactly as it was.
 *
 * Under its original ids, so an invoice still pointing at one of its week lines
 * finds it again. Two things can have changed underneath it in the meantime: a
 * client or an invoice a week line named may itself have been deleted, and a
 * fixed cost an override pointed at may be gone. Those references are dropped
 * rather than the restore failing, because the week keeps its own snapshot of
 * the name and the amount either way.
 *
 * Refused if another plan now covers those dates: the bin does not hold the
 * dates, so a plan started in the gap wins, and the two could not both exist.
 */
export async function restorePlan(
  orgId: string,
  binId: string,
): Promise<{ weeks: number }> {
  const supabase = createAdminClient();
  const { data: row, error } = await supabase
    .from("deleted_plans")
    .select("*")
    .eq("org_id", orgId)
    .eq("id", binId)
    .maybeSingle();
  if (error) throw new Error(`Failed to read the bin: ${error.message}`);
  if (!row) throw new Error("That plan is no longer in the bin.");

  const payload = row.payload as {
    plan: Record<string, unknown>;
    weeks: Record<string, unknown>[];
    entries: Record<string, unknown>[];
    expenses: Record<string, unknown>[];
  };

  const clash = await overlapping(
    orgId,
    row.starts_on as string,
    (payload.plan.horizon_months as number) ?? 1,
  );
  if (clash) {
    throw new Error(
      `A plan now covers those weeks (${clash.starts_on} to ${clash.ends_on}). ` +
        `Delete or move that one first: two plans cannot cover the same week.`,
    );
  }

  // `ends_on` is generated, so it is never written back. `org_id` is stamped
  // rather than trusted: the payload was written by this server, but a row that
  // carries its own tenant is a row that can be made to carry somebody else's,
  // and every other write in this codebase stamps it for the same reason.
  const plan: Record<string, unknown> = { ...payload.plan, org_id: orgId };
  delete plan.ends_on;

  const { error: planError } = await supabase
    .from("savings_plans")
    .insert(plan);
  if (planError) {
    throw new Error(`Failed to restore the plan: ${planError.message}`);
  }

  if (payload.weeks.length > 0) {
    const { error: weekError } = await supabase
      .from("savings_weeks")
      .insert(payload.weeks.map((w) => ({ ...w, org_id: orgId })));
    if (weekError) {
      throw new Error(`Failed to restore the weeks: ${weekError.message}`);
    }
  }

  // What still exists to point at. Anything else is nulled: the line keeps the
  // client's name and the cost keeps its own amount, so nothing is lost that
  // the week itself was holding.
  const [clients, invoices, items] = await Promise.all([
    supabase.from("clients").select("id").eq("org_id", orgId),
    supabase.from("invoices").select("id").eq("org_id", orgId),
    supabase.from("expense_items").select("id").eq("org_id", orgId),
  ]);
  const liveClients = new Set((clients.data ?? []).map((r) => r.id as string));
  const liveInvoices = new Set((invoices.data ?? []).map((r) => r.id as string));
  const liveItems = new Set((items.data ?? []).map((r) => r.id as string));

  if (payload.entries.length > 0) {
    const rows = payload.entries.map((e) => ({
      ...e,
      org_id: orgId,
      client_id: liveClients.has(e.client_id as string) ? e.client_id : null,
      invoice_id: liveInvoices.has(e.invoice_id as string) ? e.invoice_id : null,
    }));
    const { error: entryError } = await supabase
      .from("week_entries")
      .insert(rows);
    if (entryError) {
      throw new Error(`Failed to restore the work: ${entryError.message}`);
    }
  }

  if (payload.expenses.length > 0) {
    const rows = payload.expenses.map((x) => ({
      ...x,
      org_id: orgId,
      expense_item_id: liveItems.has(x.expense_item_id as string)
        ? x.expense_item_id
        : null,
    }));
    const { error: costError } = await supabase
      .from("week_expenses")
      .insert(rows);
    if (costError) {
      throw new Error(`Failed to restore the costs: ${costError.message}`);
    }
  }

  await supabase
    .from("deleted_plans")
    .delete()
    .eq("org_id", orgId)
    .eq("id", binId);

  return { weeks: payload.weeks.length };
}

/** Empty one plan out of the bin for good, before its thirty days are up. */
export async function forgetDeletedPlan(
  orgId: string,
  binId: string,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("deleted_plans")
    .delete()
    .eq("org_id", orgId)
    .eq("id", binId);
  if (error) throw new Error(`Failed to empty the bin: ${error.message}`);
}

/**
 * The first plan whose dates would collide with these, if any.
 *
 * Every plan the business has ever run, INCLUDING the ones filed away. Being
 * archived says the owner is done looking at it, not that its weeks stopped
 * happening: a new plan reaching back over them would give those weeks two
 * plans to belong to and quietly change a result that was already final.
 */
async function overlapping(
  orgId: string,
  startsOn: string,
  horizonMonths: number,
  exceptId?: string,
): Promise<SavingsPlan | null> {
  const endsOn = lastDayOf(startsOn, horizonMonths);
  const supabase = createAdminClient();
  let query = supabase
    .from("savings_plans")
    .select("*")
    .eq("org_id", orgId)
    .lte("starts_on", endsOn)
    .gte("ends_on", startsOn);
  if (exceptId) query = query.neq("id", exceptId);

  const { data, error } = await query.limit(1);
  if (error) throw new Error(`Failed to check the plans: ${error.message}`);
  return data && data.length > 0 ? normalise(data[0]) : null;
}

/**
 * The last day a plan starting then, running that long, would cover.
 *
 * The same arithmetic as the `ends_on` generated column, needed here only
 * because an overlap has to be checked BEFORE the row exists. Everywhere else
 * reads the column.
 */
export function lastDayOf(startsOn: string, horizonMonths: number): string {
  const weeks = Math.round((horizonMonths / 12) * 52);
  const [y, m, d] = startsOn.split("-").map(Number);
  const at = Date.UTC(y, m - 1, d) + (weeks * 7 - 1) * 86_400_000;
  return new Date(at).toISOString().slice(0, 10);
}

/** How many weeks a plan covers. */
export function weeksOf(plan: SavingsPlan): number {
  return Math.round((plan.horizon_months / 12) * 52);
}

/**
 * The total the plan adds up to, derived and never stored.
 *
 * Weeks rather than months, because the plan is run weekly and a month is not
 * a whole number of them. 52 weeks a year is the figure a person checks this
 * against, so it is the figure used.
 */
export function plannedTotal(plan: SavingsPlan): number {
  return plan.weekly_target * weeksOf(plan);
}

/** Has this plan's last week gone by? */
export function isFinished(plan: SavingsPlan, today = todayInSydney()): boolean {
  return plan.ends_on < today;
}
