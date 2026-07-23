"use server";

import { revalidatePath } from "next/cache";
import { createClient as createAuthClient } from "@/lib/supabase/server";
import { issuerNameFromEmail } from "@/lib/auth";
import { createInvoice } from "@/lib/data/invoices";

export type CreateInvoicePayload = {
  client_id: string;
  issuer_id: string;
  invoice_date: string;
  internal_notes: string | null;
  items: {
    description: string;
    service_date: string | null;
    quantity: number;
    rate: number;
  }[];
};

export type CreateResult = { ok: boolean; id?: string; error?: string };

export async function createInvoiceAction(
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

  // created_by = who is logged in (server-side, cannot be spoofed).
  const supabase = await createAuthClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const createdBy = issuerNameFromEmail(user?.email);

  try {
    const invoice = await createInvoice({
      client_id: payload.client_id,
      issuer_id: payload.issuer_id,
      invoice_date: payload.invoice_date,
      internal_notes: payload.internal_notes?.trim() || null,
      created_by: createdBy,
      items,
    });
    revalidatePath("/history");
    revalidatePath("/");
    return { ok: true, id: invoice.id };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to create invoice.",
    };
  }
}
