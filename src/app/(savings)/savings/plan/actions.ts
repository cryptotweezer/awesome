"use server";

import { revalidatePath } from "next/cache";
import {
  archivePlan,
  deletePlan,
  forgetDeletedPlan,
  getPlan,
  restorePlan,
  startPlan,
  updatePlan,
} from "@/lib/data/savings-plan";
import { AWESOME_ORG_ID, requireOrg, signatureFor } from "@/lib/data/org";

export type ActionState = { ok: boolean; error?: string };

function str(formData: FormData, key: string): string | null {
  const v = (formData.get(key) as string | null)?.trim();
  return v ? v : null;
}

/** A server action is a public endpoint: the gate cannot live in the page. */
async function awesome() {
  const ctx = await requireOrg();
  if (ctx.org.id !== AWESOME_ORG_ID) throw new Error("Not available.");
  return ctx;
}

/** The two numbers and the date, read off the form and checked. */
function planFields(formData: FormData):
  | { ok: true; target: number; months: number; startsOn: string }
  | { ok: false; error: string } {
  const target = Number(str(formData, "weekly_target") ?? "");
  if (!Number.isFinite(target) || target < 0) {
    return {
      ok: false,
      error: "The weekly amount must be a number, at least 0.",
    };
  }

  const months = Number(str(formData, "horizon_months") ?? "");
  if (!Number.isInteger(months) || months < 1 || months > 600) {
    return { ok: false, error: "The horizon must be a whole number of months." };
  }

  const startsOn = str(formData, "starts_on");
  if (!startsOn || !/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) {
    return { ok: false, error: "Pick the day week 1 starts on." };
  }

  return { ok: true, target, months, startsOn };
}

function done(): ActionState {
  revalidatePath("/savings/plan");
  revalidatePath("/savings/overview");
  revalidatePath("/savings/weeks");
  return { ok: true };
}

/**
 * Start a plan.
 *
 * A start date is required now, where the single plan allowed a blank one to
 * mean "not begun yet". With several plans that state has a better name:
 * nothing running, which is what having no plan row says by itself.
 */
export async function startPlanAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const fields = planFields(formData);
  if (!fields.ok) return { ok: false, error: fields.error };

  try {
    const { org } = await awesome();
    await startPlan(org.id, {
      name: str(formData, "name"),
      starts_on: fields.startsOn,
      weekly_target: fields.target,
      horizon_months: fields.months,
      notes: str(formData, "notes"),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
  return done();
}

/** Change a plan: the amount, the horizon, the start date, the name. */
export async function savePlanAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = str(formData, "id");
  if (!id) return { ok: false, error: "Missing plan." };

  const fields = planFields(formData);
  if (!fields.ok) return { ok: false, error: fields.error };

  try {
    const { org } = await awesome();
    await updatePlan(org.id, id, {
      name: str(formData, "name"),
      starts_on: fields.startsOn,
      weekly_target: fields.target,
      horizon_months: fields.months,
      notes: str(formData, "notes"),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
  return done();
}

/**
 * Extend the running plan, in months.
 *
 * A plan that reaches its horizon is finished, and the honest options are to
 * start the next one or to say this one runs longer. Both are offered where the
 * plan says it has ended; this is the second.
 */
export async function extendPlanAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = str(formData, "id");
  const by = Number(str(formData, "months") ?? "");
  if (!id) return { ok: false, error: "Missing plan." };
  if (!Number.isInteger(by) || by < 1 || by > 120) {
    return { ok: false, error: "Extend by a whole number of months." };
  }

  try {
    const { org } = await awesome();
    const plan = await getPlan(org.id, id);
    if (!plan) return { ok: false, error: "Plan not found." };
    await updatePlan(org.id, id, {
      horizon_months: plan.horizon_months + by,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
  return done();
}

/**
 * File a finished plan away, or take it back out.
 *
 * Archiving is a decision, not a date: a plan whose last date has passed stays
 * on screen until its weeks have closed and the owner says it is settled. Only
 * then does the page offer to start the next one.
 */
export async function archivePlanAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = str(formData, "id");
  if (!id) return { ok: false, error: "Missing plan." };
  const archived = formData.get("archived") !== "false";
  try {
    const { org } = await awesome();
    await archivePlan(org.id, id, archived);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
  return done();
}

/**
 * Delete a plan and every week under it.
 *
 * Three things have to line up, because this is the one action in the savings
 * half that destroys money already counted: the box has to be ticked, the
 * plan's name has to be typed out, and the vault is not allowed to end up
 * holding less than nothing unless that is asked for on purpose. Nothing about
 * the clients, the rotation, the expenses, the loans or the invoices is part of
 * a plan.
 */
export async function deletePlanAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = str(formData, "id");
  if (!id) return { ok: false, error: "Missing plan." };
  if (formData.get("confirm") !== "true") {
    return { ok: false, error: "Tick the box to confirm." };
  }

  // Typing it out is the difference between a mis-click and a decision. The
  // word is the plan's own name, or DELETE for a plan that was never named.
  const expected = str(formData, "expected_name") ?? "DELETE";
  const typed = str(formData, "typed_name");
  if ((typed ?? "").toLowerCase() !== expected.toLowerCase()) {
    return {
      ok: false,
      error: `Type ${expected} to confirm. Nothing is deleted until you do.`,
    };
  }

  try {
    const { org, member } = await awesome();
    await deletePlan(org.id, id, {
      force: formData.get("force") === "true",
      by: signatureFor(member),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
  return done();
}

/**
 * Put a deleted plan back, or empty it out of the bin early.
 *
 * The bin holds a deleted plan for thirty days and the daily cron clears it
 * after that. Restoring is an insert: the plan, its weeks and everything
 * recorded on them go back under their original ids.
 */
export async function restorePlanAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = str(formData, "id");
  if (!id) return { ok: false, error: "Missing plan." };
  const forget = formData.get("forget") === "true";
  try {
    const { org } = await awesome();
    if (forget) await forgetDeletedPlan(org.id, id);
    else await restorePlan(org.id, id);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
  return done();
}
