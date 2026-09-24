"use server";

import { revalidatePath } from "next/cache";
import {
  createExpenseItem,
  updateExpenseItem,
  deleteExpenseItem,
  type ExpenseItemInput,
} from "@/lib/data/expenses";
import { AWESOME_ORG_ID, requireOrg } from "@/lib/data/org";
import { EXPENSE_CATEGORIES } from "@/lib/savings";
import type { ExpenseCategory } from "@/lib/types";

export type ActionState = { ok: boolean; error?: string };

function str(formData: FormData, key: string): string | null {
  const v = (formData.get(key) as string | null)?.trim();
  return v ? v : null;
}

/**
 * The savings plan is Awesome's. A server action is a public endpoint, so the
 * gate cannot live only in the page that renders the form.
 */
async function awesomeOrgId(): Promise<string> {
  const { org } = await requireOrg();
  if (org.id !== AWESOME_ORG_ID) throw new Error("Not available.");
  return org.id;
}

export async function saveExpenseAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = str(formData, "id");
  const name = str(formData, "name");
  if (!name) return { ok: false, error: "Name is required." };

  const amount = Number(str(formData, "weekly_amount") ?? "0");
  if (!Number.isFinite(amount) || amount < 0) {
    return { ok: false, error: "The weekly amount must be a number, at least 0." };
  }

  const category = str(formData, "category");
  if (!category || !EXPENSE_CATEGORIES.some((c) => c.value === category)) {
    return { ok: false, error: "Pick a category." };
  }

  // Blank means it has always been there, which is what every cost meant before
  // this field existed. A date keeps it out of the weeks that ran before it.
  const startsOn = str(formData, "starts_on");
  if (startsOn && !/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) {
    return { ok: false, error: "That is not a date." };
  }

  const input: ExpenseItemInput = {
    name,
    weekly_amount: amount,
    category: category as ExpenseCategory,
    starts_on: startsOn,
  };

  try {
    const orgId = await awesomeOrgId();
    if (id) await updateExpenseItem(orgId, id, input);
    else await createExpenseItem(orgId, input);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }

  revalidatePath("/savings/expenses");
  return { ok: true };
}

export async function setExpenseActiveAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = str(formData, "id");
  if (!id) return { ok: false, error: "Missing expense id." };
  const active = formData.get("active") === "true";
  try {
    await updateExpenseItem(await awesomeOrgId(), id, { is_active: active });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
  revalidatePath("/savings/expenses");
  return { ok: true };
}

export async function deleteExpenseAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = str(formData, "id");
  if (!id) return { ok: false, error: "Missing expense id." };
  try {
    await deleteExpenseItem(await awesomeOrgId(), id);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Delete failed." };
  }
  revalidatePath("/savings/expenses");
  return { ok: true };
}
