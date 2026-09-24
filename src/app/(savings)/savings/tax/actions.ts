"use server";

import { revalidatePath } from "next/cache";
import { AWESOME_ORG_ID, requireOrg, signatureFor } from "@/lib/data/org";
import { deleteDeduction, saveDeduction } from "@/lib/data/tax";
import { todayInSydney } from "@/lib/format";
import { DEDUCTION_CATEGORIES } from "@/lib/savings";
import type { DeductionCategory } from "@/lib/types";

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

/**
 * Record what the accountant will take off, or change it.
 *
 * It belongs to one ABN and one day. Nothing else in the app reads it: it is not
 * a weekly cost, it never touches a week or the vault, and it appears in one
 * place besides this page, that ABN's tax statement.
 */
export async function saveDeductionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const issuerId = str(formData, "issuer_id");
  if (!issuerId) return { ok: false, error: "Missing the ABN." };

  const description = str(formData, "description");
  if (!description) return { ok: false, error: "Say what it was." };

  const amount = Number(str(formData, "amount") ?? "");
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "The amount must be more than 0." };
  }

  const category = (str(formData, "category") ?? "other") as DeductionCategory;
  if (!DEDUCTION_CATEGORIES.some((c) => c.value === category)) {
    return { ok: false, error: "Pick one of the kinds." };
  }

  try {
    const { org, member } = await awesome();
    await saveDeduction(
      org.id,
      {
        issuer_id: issuerId,
        // The day the money was spent, which is what puts it in a financial
        // year. Defaults to today in Sydney, never a UTC date.
        spent_on: str(formData, "spent_on") ?? todayInSydney(),
        amount,
        category,
        description,
        note: str(formData, "note"),
        recorded_by: signatureFor(member),
      },
      str(formData, "id") ?? undefined,
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }

  revalidatePath("/savings/tax");
  return { ok: true };
}

export async function deleteDeductionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = str(formData, "id");
  if (!id) return { ok: false, error: "Missing the expense." };
  try {
    const { org } = await awesome();
    await deleteDeduction(org.id, id);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
  revalidatePath("/savings/tax");
  return { ok: true };
}
