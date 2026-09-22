"use server";

import { revalidatePath } from "next/cache";
import {
  createLoan,
  updateLoan,
  deleteLoan,
  recordLoanPayment,
  deleteLoanPayment,
  type LoanInput,
} from "@/lib/data/loans";
import { AWESOME_ORG_ID, requireOrg, signatureFor } from "@/lib/data/org";
import { todayInSydney } from "@/lib/format";

export type ActionState = { ok: boolean; error?: string };

function str(formData: FormData, key: string): string | null {
  const v = (formData.get(key) as string | null)?.trim();
  return v ? v : null;
}

/** A server action is a public endpoint, so the gate cannot live in the page. */
async function awesome() {
  const ctx = await requireOrg();
  if (ctx.org.id !== AWESOME_ORG_ID) throw new Error("Not available.");
  return ctx;
}

function money(formData: FormData, key: string): number | null {
  const raw = str(formData, key);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function saveLoanAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = str(formData, "id");
  const name = str(formData, "name");
  if (!name) return { ok: false, error: "Name is required." };

  const principal = money(formData, "principal");
  if (principal === null || principal < 0) {
    return { ok: false, error: "The amount owed must be a number, at least 0." };
  }

  const weekly = money(formData, "weekly_payment") ?? 0;
  if (weekly < 0) {
    return { ok: false, error: "The weekly payment cannot be negative." };
  }

  const input: LoanInput = {
    name,
    principal,
    weekly_payment: weekly,
    // Both optional. Blank means "no date", which is the truth for a loan paid
    // whenever there is money for it.
    started_on: str(formData, "started_on"),
    ends_on: str(formData, "ends_on"),
    notes: str(formData, "notes"),
  };

  try {
    const { org } = await awesome();
    if (id) await updateLoan(org.id, id, input);
    else await createLoan(org.id, input);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }

  revalidatePath("/savings/loans");
  revalidatePath("/savings/plan");
  return { ok: true };
}

export async function setLoanActiveAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = str(formData, "id");
  if (!id) return { ok: false, error: "Missing loan id." };
  const active = formData.get("active") === "true";
  try {
    const { org } = await awesome();
    await updateLoan(org.id, id, { is_active: active });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
  revalidatePath("/savings/loans");
  revalidatePath("/savings/plan");
  return { ok: true };
}

export async function deleteLoanAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = str(formData, "id");
  if (!id) return { ok: false, error: "Missing loan id." };
  try {
    const { org } = await awesome();
    await deleteLoan(org.id, id);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Delete failed." };
  }
  revalidatePath("/savings/loans");
  revalidatePath("/savings/plan");
  return { ok: true };
}

export async function recordLoanPaymentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const loanId = str(formData, "loan_id");
  if (!loanId) return { ok: false, error: "Missing loan id." };

  const amount = money(formData, "amount");
  if (amount === null || amount <= 0) {
    return { ok: false, error: "The payment must be more than 0." };
  }

  try {
    const { org, member } = await awesome();
    await recordLoanPayment(org.id, {
      loan_id: loanId,
      amount,
      // The day the money left, which defaults to today in Sydney rather than
      // to a UTC date that is tomorrow for half the evening.
      paid_on: str(formData, "paid_on") ?? todayInSydney(),
      note: str(formData, "note"),
      recorded_by: signatureFor(member),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }

  revalidatePath("/savings/loans");
  revalidatePath("/savings/plan");
  return { ok: true };
}

export async function deleteLoanPaymentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = str(formData, "id");
  if (!id) return { ok: false, error: "Missing payment id." };
  try {
    const { org } = await awesome();
    await deleteLoanPayment(org.id, id);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
  revalidatePath("/savings/loans");
  revalidatePath("/savings/plan");
  return { ok: true };
}
