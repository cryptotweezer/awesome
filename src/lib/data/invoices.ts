import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Invoice, InvoiceItem, InvoiceStatus } from "@/lib/types";

export type InvoiceListRow = Invoice & {
  issuer: { short_name: string } | null;
  invoice_items: { service_date: string | null }[];
};

export async function listInvoices(): Promise<InvoiceListRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("*, issuer:issuers(short_name), invoice_items(service_date)")
    .order("invoice_number", { ascending: true });
  if (error) throw new Error(`Failed to load invoices: ${error.message}`);
  return (data ?? []) as unknown as InvoiceListRow[];
}

export type InvoiceDetail = Invoice & {
  issuer: { short_name: string } | null;
  invoice_items: InvoiceItem[];
};

export async function getInvoice(id: string): Promise<InvoiceDetail | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("*, issuer:issuers(short_name), invoice_items(*)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load invoice: ${error.message}`);
  if (!data) return null;
  // keep line items in a stable order
  const detail = data as unknown as InvoiceDetail;
  detail.invoice_items.sort((a, b) => a.sort_order - b.sort_order);
  return detail;
}

/**
 * The number the next inserted invoice WOULD receive, without consuming the
 * sequence. This is an estimate for display only — the definitive number is
 * assigned atomically by the DB at insert time and can never collide, even if
 * the dashboard and the AI create invoices simultaneously.
 */
export async function getNextInvoiceNumber(): Promise<number | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("peek_next_invoice_number");
  if (error) {
    // Non-fatal: the form just won't show a preview.
    console.error("peek_next_invoice_number failed:", error.message);
    return null;
  }
  return typeof data === "number" ? data : null;
}

export type OutstandingInvoice = {
  id: string;
  invoice_number: number;
  amount: number;
  due_date: string;
  overdue: boolean;
};

export type OutstandingClient = {
  client_name: string;
  amount: number;
  count: number;
  overdueAmount: number;
  overdueCount: number;
  invoices: OutstandingInvoice[];
};

export type OutstandingSummary = {
  totalAmount: number;
  totalCount: number;
  overdueAmount: number;
  overdueCount: number;
  currentAmount: number;
  currentCount: number;
  byClient: OutstandingClient[];
};

/**
 * Aggregate every unpaid/partial invoice into a per-client outstanding summary,
 * splitting overdue (past the 7-day term) from those still within term. Overdue
 * is DERIVED here (due_date < today), never stored.
 */
export async function getOutstandingSummary(): Promise<OutstandingSummary> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("id, invoice_number, bill_to_name, balance_due, due_date, status")
    .in("status", ["unpaid", "partial"]);
  if (error) throw new Error(`Failed to load outstanding: ${error.message}`);

  const today = new Date().toISOString().slice(0, 10);
  const rows = data ?? [];

  let totalAmount = 0;
  let overdueAmount = 0;
  let overdueCount = 0;
  const byClient = new Map<string, OutstandingClient>();

  for (const r of rows) {
    const amount = Number(r.balance_due);
    const overdue = r.due_date < today;
    totalAmount += amount;
    if (overdue) {
      overdueAmount += amount;
      overdueCount += 1;
    }
    const entry =
      byClient.get(r.bill_to_name) ??
      {
        client_name: r.bill_to_name,
        amount: 0,
        count: 0,
        overdueAmount: 0,
        overdueCount: 0,
        invoices: [] as OutstandingInvoice[],
      };
    entry.amount += amount;
    entry.count += 1;
    if (overdue) {
      entry.overdueAmount += amount;
      entry.overdueCount += 1;
    }
    entry.invoices.push({
      id: r.id,
      invoice_number: r.invoice_number,
      amount,
      due_date: r.due_date,
      overdue,
    });
    byClient.set(r.bill_to_name, entry);
  }

  // Newest-billed invoices first within each client (by number desc).
  for (const c of byClient.values()) {
    c.invoices.sort((a, b) => b.invoice_number - a.invoice_number);
  }

  return {
    totalAmount,
    totalCount: rows.length,
    overdueAmount,
    overdueCount,
    currentAmount: totalAmount - overdueAmount,
    currentCount: rows.length - overdueCount,
    // Clients with overdue balances float to the top, then by amount.
    byClient: Array.from(byClient.values()).sort(
      (a, b) => b.overdueAmount - a.overdueAmount || b.amount - a.amount,
    ),
  };
}

export type NewInvoiceItem = {
  description: string;
  service_date: string | null;
  quantity: number;
  rate: number;
};

export type NewInvoiceInput = {
  client_id: string;
  issuer_id: string;
  invoice_date: string;
  internal_notes: string | null;
  created_by: string;
  items: NewInvoiceItem[];
};

export async function createInvoice(input: NewInvoiceInput): Promise<Invoice> {
  const supabase = createAdminClient();

  // Snapshot the client and issuer at creation time.
  const { data: client, error: cErr } = await supabase
    .from("clients")
    .select("*")
    .eq("id", input.client_id)
    .single();
  if (cErr || !client) throw new Error("Client not found.");

  const { data: issuer, error: iErr } = await supabase
    .from("issuers")
    .select("*")
    .eq("id", input.issuer_id)
    .single();
  if (iErr || !issuer) throw new Error("Issuer not found.");

  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .insert({
      issuer_id: issuer.id,
      issuer_name: issuer.full_name,
      issuer_abn: issuer.abn,
      client_id: client.id,
      bill_to_name: client.name,
      bill_to_address_line: client.address_line,
      bill_to_suburb: client.suburb,
      bill_to_state: client.state,
      bill_to_postcode: client.postcode,
      invoice_date: input.invoice_date,
      internal_notes: input.internal_notes,
      created_by: input.created_by,
    })
    .select("*")
    .single();
  if (invErr || !invoice) {
    throw new Error(`Failed to create invoice: ${invErr?.message}`);
  }

  const items = input.items.map((it, idx) => ({
    invoice_id: invoice.id,
    description: it.description,
    service_date: it.service_date,
    quantity: it.quantity,
    rate: it.rate,
    sort_order: idx,
  }));

  const { error: itemsErr } = await supabase.from("invoice_items").insert(items);
  if (itemsErr) {
    // roll back the empty invoice so we don't leave an orphan / burnt number gap
    await supabase.from("invoices").delete().eq("id", invoice.id);
    throw new Error(`Failed to add invoice items: ${itemsErr.message}`);
  }

  // re-read to get trigger-computed totals
  const { data: fresh } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", invoice.id)
    .single();
  return (fresh ?? invoice) as Invoice;
}

export type UpdateInvoiceInput = {
  client_id: string;
  issuer_id: string;
  invoice_date: string;
  internal_notes: string | null;
  items: NewInvoiceItem[];
};

/**
 * Edit an existing invoice. Re-snapshots the client + issuer (so a corrected
 * client choice updates the bill-to block) and fully replaces the line items.
 * The invoice_number is never touched. Triggers recompute due_date, totals,
 * balance_due and status. Available to the dashboard AND the AI (fix a mistake).
 */
export async function updateInvoice(
  id: string,
  input: UpdateInvoiceInput,
): Promise<Invoice> {
  const supabase = createAdminClient();

  const { data: client, error: cErr } = await supabase
    .from("clients")
    .select("*")
    .eq("id", input.client_id)
    .single();
  if (cErr || !client) throw new Error("Client not found.");

  const { data: issuer, error: iErr } = await supabase
    .from("issuers")
    .select("*")
    .eq("id", input.issuer_id)
    .single();
  if (iErr || !issuer) throw new Error("Issuer not found.");

  const { error: upErr } = await supabase
    .from("invoices")
    .update({
      issuer_id: issuer.id,
      issuer_name: issuer.full_name,
      issuer_abn: issuer.abn,
      client_id: client.id,
      bill_to_name: client.name,
      bill_to_address_line: client.address_line,
      bill_to_suburb: client.suburb,
      bill_to_state: client.state,
      bill_to_postcode: client.postcode,
      invoice_date: input.invoice_date,
      internal_notes: input.internal_notes,
    })
    .eq("id", id);
  if (upErr) throw new Error(`Failed to update invoice: ${upErr.message}`);

  // Replace all line items (simplest correct approach; triggers recompute totals).
  const { error: delErr } = await supabase
    .from("invoice_items")
    .delete()
    .eq("invoice_id", id);
  if (delErr) throw new Error(`Failed to update items: ${delErr.message}`);

  const items = input.items.map((it, idx) => ({
    invoice_id: id,
    description: it.description,
    service_date: it.service_date,
    quantity: it.quantity,
    rate: it.rate,
    sort_order: idx,
  }));
  const { error: insErr } = await supabase.from("invoice_items").insert(items);
  if (insErr) throw new Error(`Failed to update items: ${insErr.message}`);

  const { data: fresh } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", id)
    .single();
  if (!fresh) throw new Error("Invoice vanished after update.");
  return fresh as Invoice;
}

/**
 * Permanently delete an invoice and its line items. This is a HARD delete
 * (unlike cancel, which keeps the record). For the AI, deletion is the one
 * action that must always ask the user for confirmation first.
 */
export async function deleteInvoice(id: string): Promise<void> {
  const supabase = createAdminClient();
  // Atomic in the DB: deletes items + invoice AND resyncs the number sequence
  // so deleting the latest invoice reclaims its number (floor stays at 1945).
  const { error } = await supabase.rpc("delete_invoice", { p_id: id });
  if (error) throw new Error(`Failed to delete invoice: ${error.message}`);
}

/** Set the paid amount (and let the trigger derive status + balance_due). */
export async function setInvoicePaidAmount(
  id: string,
  paidAmount: number,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("invoices")
    .update({ paid_amount: paidAmount })
    .eq("id", id);
  if (error) throw new Error(`Failed to update payment: ${error.message}`);
}

export async function setInvoiceStatus(
  id: string,
  status: InvoiceStatus,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("invoices")
    .update({ status })
    .eq("id", id);
  if (error) throw new Error(`Failed to update status: ${error.message}`);
}
