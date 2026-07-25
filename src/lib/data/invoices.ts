import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayInSydney } from "@/lib/format";
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
 * Resolve an invoice by EITHER its UUID or its invoice_number, so an agent can
 * ask for "1954" without first resolving a UUID. An all-digit ref is treated as
 * an invoice number; anything else falls back to a UUID lookup.
 */
export async function getInvoiceByRef(
  ref: string,
): Promise<InvoiceDetail | null> {
  const trimmed = ref.trim();
  if (!/^\d+$/.test(trimmed)) return getInvoice(trimmed);

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("*, issuer:issuers(short_name), invoice_items(*)")
    .eq("invoice_number", Number(trimmed))
    .maybeSingle();
  if (error) throw new Error(`Failed to load invoice: ${error.message}`);
  if (!data) return null;
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
 * Aggregate every unpaid invoice into a per-client outstanding summary,
 * splitting overdue (past the 7-day term) from those still within term. Overdue
 * is DERIVED here (due_date < today), never stored.
 */
export async function getOutstandingSummary(): Promise<OutstandingSummary> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("id, invoice_number, bill_to_name, balance_due, due_date, status")
    .eq("status", "unpaid");
  if (error) throw new Error(`Failed to load outstanding: ${error.message}`);

  const today = todayInSydney();
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
    const entry = byClient.get(r.bill_to_name) ?? {
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

/**
 * Start of the current Australian financial year (1 Jul – 30 Jun) as YYYY-MM-DD.
 * Rolls over on its own — no config to remember every July.
 */
export function financialYearStart(today: string = todayInSydney()): string {
  const [y, m] = today.split("-").map(Number);
  // Jan–Jun still belong to the FY that started the previous July.
  const startYear = m >= 7 ? y : y - 1;
  return `${startYear}-07-01`;
}

/** "FY 2026-27" for the FY that began on the given start date. */
export function financialYearLabel(start: string): string {
  const y = Number(start.slice(0, 4));
  return `FY ${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

/** Last day of the FY that began on the given start date. */
export function financialYearEnd(start: string): string {
  return `${Number(start.slice(0, 4)) + 1}-06-30`;
}

export type PeriodTotal = { fy: number; all: number };

export type BillingTotals = {
  fyStart: string;
  fyEnd: string;
  fyLabel: string;
  /** Money actually received (status = paid). */
  paid: PeriodTotal;
  /** Everything issued under each ABN, cancelled excluded. */
  byIssuer: { short_name: string; total: PeriodTotal }[];
};

/**
 * Headline totals for the Overview: what has been collected, and how much each
 * ABN has billed. Both split into the current financial year and all time.
 * Bucketed by `invoice_date` — there is no separate payment date on record.
 */
export async function getBillingTotals(): Promise<BillingTotals> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("invoice_date, total, status, issuer:issuers(short_name)");
  if (error) throw new Error(`Failed to load totals: ${error.message}`);

  const fyStart = financialYearStart();
  const paid: PeriodTotal = { fy: 0, all: 0 };
  const byIssuer = new Map<string, PeriodTotal>();

  for (const r of (data ?? []) as unknown as {
    invoice_date: string;
    total: number;
    status: InvoiceStatus;
    issuer: { short_name: string } | null;
  }[]) {
    if (r.status === "cancelled") continue;
    const amount = Number(r.total);
    const inFy = r.invoice_date >= fyStart;

    if (r.status === "paid") {
      paid.all += amount;
      if (inFy) paid.fy += amount;
    }

    const name = r.issuer?.short_name ?? "—";
    const entry = byIssuer.get(name) ?? { fy: 0, all: 0 };
    entry.all += amount;
    if (inFy) entry.fy += amount;
    byIssuer.set(name, entry);
  }

  return {
    fyStart,
    fyEnd: financialYearEnd(fyStart),
    fyLabel: financialYearLabel(fyStart),
    paid,
    byIssuer: Array.from(byIssuer, ([short_name, total]) => ({
      short_name,
      total,
    })).sort((a, b) => a.short_name.localeCompare(b.short_name)),
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
  // Atomic in the DB (awesome.create_invoice): snapshots the client + issuer,
  // inserts the header and the items in ONE transaction and rejects an empty
  // item list. This is the same function every agent calls, so the rules live
  // in Postgres, not here.
  const { data, error } = await supabase.rpc("create_invoice", {
    p_client_id: input.client_id,
    p_issuer_id: input.issuer_id,
    p_invoice_date: input.invoice_date,
    p_created_by: input.created_by,
    p_items: input.items,
    p_internal_notes: input.internal_notes,
  });
  if (error || !data) {
    throw new Error(`Failed to create invoice: ${error?.message}`);
  }
  return data as Invoice;
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
  // Atomic in the DB (awesome.update_invoice): re-snapshots the client + issuer
  // and fully replaces the line items in one transaction. invoice_number and
  // created_by are never touched.
  const { data, error } = await supabase.rpc("update_invoice", {
    p_id: id,
    p_client_id: input.client_id,
    p_issuer_id: input.issuer_id,
    p_invoice_date: input.invoice_date,
    p_items: input.items,
    p_internal_notes: input.internal_notes,
  });
  if (error || !data) {
    throw new Error(`Failed to update invoice: ${error?.message}`);
  }
  return data as Invoice;
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

/**
 * Mark an invoice paid in full. No partial payments: the DB sets
 * paid_amount = total and the trigger derives status = paid, balance_due = 0.
 * Rejected on a cancelled invoice (reactivate it first).
 */
export async function markPaid(id: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.rpc("mark_paid", { p_id: id });
  if (error) throw new Error(`Failed to mark paid: ${error.message}`);
}

/** Undo a payment: paid_amount back to 0, status re-derived to unpaid. */
export async function markUnpaid(id: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.rpc("mark_unpaid", { p_id: id });
  if (error) throw new Error(`Failed to mark unpaid: ${error.message}`);
}

/** Cancel an invoice: status = cancelled, the number is kept (never released). */
export async function cancelInvoice(id: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.rpc("cancel_invoice", { p_id: id });
  if (error) throw new Error(`Failed to cancel invoice: ${error.message}`);
}

/**
 * Undo a cancellation (cancelled by mistake). The DB writes a non-cancelled
 * status so the trigger re-derives the real one from paid_amount, landing back
 * on unpaid or paid on its own.
 */
export async function reactivateInvoice(id: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.rpc("reactivate_invoice", { p_id: id });
  if (error) throw new Error(`Failed to reactivate invoice: ${error.message}`);
}
