"use server";

import { revalidatePath } from "next/cache";
import {
  addEntry,
  closeWeek,
  deleteEntry,
  deleteWeekExpense,
  getEntry,
  reopenWeek,
  setWeekExpense,
  updateEntry,
  updateWeek,
  type EntryPatch,
} from "@/lib/data/weeks";
import { getClient } from "@/lib/data/clients";
import { AWESOME_ORG_ID, requireOrg, signatureFor } from "@/lib/data/org";
import { todayInSydney } from "@/lib/format";
import type { ExpenseCategory } from "@/lib/types";

export type ActionState = { ok: boolean; error?: string };

function str(formData: FormData, key: string): string | null {
  const v = (formData.get(key) as string | null)?.trim();
  return v ? v : null;
}

function money(formData: FormData, key: string, fallback = 0): number {
  const raw = str(formData, key);
  if (raw === null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** A server action is a public endpoint: the gate cannot live in the page. */
async function awesome() {
  const ctx = await requireOrg();
  if (ctx.org.id !== AWESOME_ORG_ID) throw new Error("Not available.");
  return ctx;
}

function done(weekId: string): ActionState {
  revalidatePath(`/savings/weeks/${weekId}`);
  revalidatePath("/savings/overview");
  revalidatePath("/savings/plan");
  return { ok: true };
}

/**
 * One line of a week.
 *
 * Everything about what actually happened lives here: whether the work was
 * done, which day it really happened on, what it came to, the extra, how it was
 * paid. A line linked to an invoice takes its amount and payment from that
 * invoice, so those fields are ignored rather than fought over.
 */
export async function saveEntryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = str(formData, "id");
  const weekId = str(formData, "week_id");
  if (!id || !weekId) return { ok: false, error: "Missing line." };

  const status = str(formData, "status");
  if (status && !["expected", "done", "skipped"].includes(status)) {
    return { ok: false, error: "Unknown status." };
  }

  const method = str(formData, "method");
  if (method && !["cash", "account", "transfer"].includes(method)) {
    return { ok: false, error: "Unknown payment method." };
  }

  const dayRaw = str(formData, "day");
  const day = dayRaw === null ? null : Number(dayRaw);
  if (day !== null && (!Number.isInteger(day) || day < 1 || day > 7)) {
    return { ok: false, error: "Unknown day." };
  }

  const paid = formData.get("paid") === "true";

  const patch: EntryPatch = {
    ...(status ? { status: status as EntryPatch["status"] } : {}),
    ...(method ? { method: method as EntryPatch["method"] } : {}),
    day,
    amount: money(formData, "amount"),
    extra_amount: money(formData, "extra_amount"),
    extra_note: str(formData, "extra_note"),
    note: str(formData, "note"),
    paid,
    // The day money arrived matters as much as the day the work did: a client
    // who pays six weeks late is the whole reason a week stays open.
    paid_on: paid ? (str(formData, "paid_on") ?? todayInSydney()) : null,
  };

  try {
    const { org } = await awesome();
    await updateEntry(org.id, id, patch);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
  return done(weekId);
}

/**
 * The extra work on one line: an amount and what it was.
 *
 * Its own action, and not a trip through the edit form, because this is the
 * correction that actually happens during a week: the usual clean plus the
 * oven, plus the windows, on the day, for one client. Everything else about
 * the line is left alone, which is what makes it safe to use one-handed.
 *
 * A line that follows an invoice is refused: there the extra is another invoice
 * line, and holding it here as well would count the same money twice.
 */
export async function saveEntryExtraAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = str(formData, "id");
  const weekId = str(formData, "week_id");
  if (!id || !weekId) return { ok: false, error: "Missing line." };

  const amount = money(formData, "extra_amount", -1);
  if (amount < 0) {
    return { ok: false, error: "The extra must be an amount of 0 or more." };
  }

  try {
    const { org } = await awesome();
    const entry = await getEntry(org.id, id);
    if (!entry) return { ok: false, error: "That line is gone." };
    if (entry.invoice_id) {
      return {
        ok: false,
        error:
          "This line follows an invoice. Add the extra as a line on the invoice instead.",
      };
    }
    await updateEntry(org.id, id, {
      extra_amount: amount,
      extra_note: amount > 0 ? str(formData, "extra_note") : null,
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
  return done(weekId);
}

/**
 * The day a job actually happened.
 *
 * The rotation says Tuesday; sometimes it is Thursday. The line moves, the
 * rotation does not, and the week keeps the day it really happened on. On its
 * own action because it is a one-touch correction, made while looking at the
 * week rather than through a form.
 *
 * A line that follows an invoice is refused: there the day comes from the
 * invoice's service date, and the two have to agree or the week would stop
 * finding it.
 */
export async function setEntryDayAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = str(formData, "id");
  const weekId = str(formData, "week_id");
  if (!id || !weekId) return { ok: false, error: "Missing line." };

  const raw = str(formData, "day");
  const day = raw === null ? null : Number(raw);
  if (day !== null && (!Number.isInteger(day) || day < 1 || day > 7)) {
    return { ok: false, error: "Unknown day." };
  }

  try {
    const { org } = await awesome();
    const entry = await getEntry(org.id, id);
    if (!entry) return { ok: false, error: "That line is gone." };
    if (entry.invoice_id) {
      return {
        ok: false,
        error:
          "This line follows an invoice. Change the service date on the invoice and the week follows it.",
      };
    }
    await updateEntry(org.id, id, { day });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
  return done(weekId);
}

/** Mark a line done, cancelled or back to planned, without opening a form. */
export async function setEntryStatusAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = str(formData, "id");
  const weekId = str(formData, "week_id");
  const status = str(formData, "status");
  if (!id || !weekId || !status) return { ok: false, error: "Missing line." };
  if (!["expected", "done", "skipped"].includes(status)) {
    return { ok: false, error: "Unknown status." };
  }

  try {
    const { org } = await awesome();
    // A cash job is paid on the day unless somebody says otherwise, which is
    // how it actually works: the money is handed over as the work finishes.
    const cash = formData.get("method") === "cash";
    await updateEntry(org.id, id, {
      status: status as EntryPatch["status"],
      ...(status === "done" && cash
        ? { paid: true, paid_on: todayInSydney() }
        : {}),
      ...(status === "skipped" ? { paid: false, paid_on: null } : {}),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
  return done(weekId);
}

/** Money in, from somebody who is not on this week's list. */
export async function addEntryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const weekId = str(formData, "week_id");
  if (!weekId) return { ok: false, error: "Missing week." };

  const clientId = str(formData, "client_id");
  const name = str(formData, "client_name");
  if (!clientId && !name) {
    return { ok: false, error: "Pick a client, or name the one-off job." };
  }

  const amount = money(formData, "amount");
  if (amount < 0) return { ok: false, error: "The amount cannot be negative." };

  const asked = str(formData, "method");
  const method =
    asked === "account" ? "account" : asked === "transfer" ? "transfer" : "cash";
  const dayRaw = str(formData, "day");

  try {
    const { org } = await awesome();

    // A client's line is named after the client, read from the client list
    // rather than taken from the form: the picker sends an id, and a name
    // typed into a hidden field is how a real client ended up on a week
    // called "Job". A one-off carries its own name, because it creates
    // nobody and there is nothing to read it from later.
    let label = name;
    if (clientId) {
      const client = await getClient(org.id, clientId);
      if (!client) return { ok: false, error: "That client is gone." };
      label = client.name;
    }

    await addEntry(org.id, {
      week_id: weekId,
      client_id: clientId,
      client_name: label ?? "Job",
      source: clientId ? "adhoc" : "oneoff",
      amount,
      day: dayRaw ? Number(dayRaw) : null,
      method,
      paid: method === "cash",
      note: str(formData, "note"),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
  return done(weekId);
}

export async function deleteEntryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = str(formData, "id");
  const weekId = str(formData, "week_id");
  if (!id || !weekId) return { ok: false, error: "Missing line." };
  try {
    const { org } = await awesome();
    await deleteEntry(org.id, id);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
  return done(weekId);
}

/**
 * What a standing expense really cost this week, or one that happened once.
 * Neither touches the standing list, so no other week moves.
 */
export async function saveWeekExpenseAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const weekId = str(formData, "week_id");
  if (!weekId) return { ok: false, error: "Missing week." };

  const itemId = str(formData, "expense_item_id");
  const name = str(formData, "name");
  if (!itemId && !name) return { ok: false, error: "Name the expense." };

  const amount = money(formData, "amount", -1);
  if (amount < 0) return { ok: false, error: "The amount must be at least 0." };

  // A cost that happened once in one week is just a cost: it is not asked
  // which commitment it belongs to, because the three categories exist to
  // group the STANDING list and nobody sorts a parking ticket. An override of
  // a standing item keeps that item's own category, set below.
  const category = str(formData, "category") ?? "australia";
  if (!["australia", "colombia", "visa"].includes(category)) {
    return { ok: false, error: "Unknown category." };
  }

  try {
    const { org } = await awesome();
    await setWeekExpense(org.id, weekId, {
      expense_item_id: itemId,
      name: name ?? str(formData, "fallback_name") ?? "Expense",
      category: category as ExpenseCategory,
      amount,
      kind: itemId ? "override" : "oneoff",
      note: str(formData, "note"),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
  return done(weekId);
}

export async function deleteWeekExpenseAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = str(formData, "id");
  const weekId = str(formData, "week_id");
  if (!id || !weekId) return { ok: false, error: "Missing expense." };
  try {
    const { org } = await awesome();
    await deleteWeekExpense(org.id, id);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
  return done(weekId);
}

export async function saveWeekNotesAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const weekId = str(formData, "week_id");
  if (!weekId) return { ok: false, error: "Missing week." };
  try {
    const { org } = await awesome();
    await updateWeek(org.id, weekId, { notes: str(formData, "notes") });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
  return done(weekId);
}

/**
 * Close the week, confirming what was saved.
 *
 * The figure is offered, not imposed: a person looking at their bank knows
 * things this table does not. Whatever they confirm is what the plan counts.
 *
 * `force` is the answer to the billing guard: work done on account has to be
 * invoiced and paid before a week closes, and getting past that is a deliberate
 * tick rather than something that happens by accident.
 */
export async function closeWeekAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const weekId = str(formData, "week_id");
  if (!weekId) return { ok: false, error: "Missing week." };

  const savedRaw = str(formData, "saved");
  const saved = savedRaw === null ? undefined : Number(savedRaw);
  if (saved !== undefined && !Number.isFinite(saved)) {
    return { ok: false, error: "The amount saved must be a number." };
  }

  try {
    const { org, member } = await awesome();
    await closeWeek(org.id, weekId, {
      saved,
      by: signatureFor(member),
      notes: str(formData, "notes"),
      force: formData.get("force") === "true",
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
  return done(weekId);
}

/** Nothing is sealed. Real life does not stop being wrong on Friday. */
export async function reopenWeekAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const weekId = str(formData, "week_id");
  if (!weekId) return { ok: false, error: "Missing week." };
  try {
    const { org } = await awesome();
    await reopenWeek(org.id, weekId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
  return done(weekId);
}
