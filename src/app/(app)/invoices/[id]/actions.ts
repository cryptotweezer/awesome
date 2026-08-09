"use server";

import { revalidatePath } from "next/cache";
import {
  markPaid,
  markUnpaid,
  cancelInvoice,
  reactivateInvoice,
  updateInvoice,
  deleteInvoice,
} from "@/lib/data/invoices";
import { requireOrg } from "@/lib/data/org";
import type { CreateInvoicePayload, CreateResult } from "../new/actions";

export type ActionState = { ok: boolean; error?: string };

/**
 * Every action here takes an invoice id straight from the browser, so the org
 * has to come from the session instead. Passing it through means the DB refuses
 * an id belonging to another business rather than acting on it.
 */
async function currentOrgId(): Promise<string> {
  const { org } = await requireOrg();
  return org.id;
}

async function refresh(id: string) {
  revalidatePath(`/invoices/${id}`);
  revalidatePath("/history");
  revalidatePath("/");
}

export async function markPaidAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = formData.get("id") as string;
  try {
    await markPaid(await currentOrgId(), id);
    await refresh(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

/** Same as markPaidAction but called directly by id (history quick-action). */
export async function markPaidByIdAction(id: string): Promise<ActionState> {
  try {
    await markPaid(await currentOrgId(), id);
    await refresh(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

export async function markUnpaidAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = formData.get("id") as string;
  try {
    await markUnpaid(await currentOrgId(), id);
    await refresh(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

/** Same as markUnpaidAction but called directly by id (history quick-action). */
export async function markUnpaidByIdAction(id: string): Promise<ActionState> {
  try {
    await markUnpaid(await currentOrgId(), id);
    await refresh(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

export async function cancelInvoiceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = formData.get("id") as string;
  try {
    await cancelInvoice(await currentOrgId(), id);
    await refresh(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

/** Same as cancelInvoiceAction but called directly by id (history quick-action). */
export async function cancelInvoiceByIdAction(
  id: string,
): Promise<ActionState> {
  try {
    await cancelInvoice(await currentOrgId(), id);
    await refresh(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

export async function reactivateInvoiceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = formData.get("id") as string;
  try {
    await reactivateInvoice(await currentOrgId(), id);
    await refresh(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

/** Same as reactivateInvoiceAction but called directly by id (history menu). */
export async function reactivateInvoiceByIdAction(
  id: string,
): Promise<ActionState> {
  try {
    await reactivateInvoice(await currentOrgId(), id);
    await refresh(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

/**
 * Edit an existing invoice. Same payload shape as create; bound to an id in the
 * edit page. created_by is intentionally left untouched. Available to the AI.
 */
export async function updateInvoiceAction(
  id: string,
  payload: CreateInvoicePayload,
): Promise<CreateResult> {
  if (!payload.client_id) return { ok: false, error: "Pick a client." };
  if (!payload.issuer_id) return { ok: false, error: "Pick an ABN (issuer)." };

  const items = payload.items
    .map((it) => ({
      description: it.description?.trim() || "Cleaning Service",
      service_date: it.service_date || null,
      quantity: Number(it.quantity) || 0,
      rate: Number(it.rate) || 0,
    }))
    .filter((it) => it.quantity > 0);

  if (items.length === 0) {
    return { ok: false, error: "Add at least one line with a quantity." };
  }

  try {
    const inv = await updateInvoice(await currentOrgId(), id, {
      client_id: payload.client_id,
      issuer_id: payload.issuer_id,
      invoice_date: payload.invoice_date,
      internal_notes: payload.internal_notes?.trim() || null,
      items,
    });
    await refresh(id);
    return { ok: true, id: inv.id };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to update invoice.",
    };
  }
}

/**
 * Permanently delete an invoice (hard delete). Called directly (id, not
 * FormData) so both the detail page and the history quick-actions can use it
 * from a transition. For the AI this is the ONE action that must be confirmed
 * with the user before running.
 */
export async function deleteInvoiceAction(id: string): Promise<ActionState> {
  try {
    await deleteInvoice(await currentOrgId(), id);
    revalidatePath("/history");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}
