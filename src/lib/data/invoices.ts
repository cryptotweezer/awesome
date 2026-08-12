import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayInSydney, todayInTimezone } from "@/lib/format";
import type { Invoice, InvoiceItem, InvoiceStatus, Org } from "@/lib/types";

export type InvoiceListRow = Invoice & {
  issuer: { short_name: string } | null;
  invoice_items: { service_date: string | null }[];
};

export async function listInvoices(orgId: string): Promise<InvoiceListRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("*, issuer:issuers(short_name), invoice_items(service_date)")
    .eq("org_id", orgId)
    .order("invoice_number", { ascending: true });
  if (error) throw new Error(`Failed to load invoices: ${error.message}`);
  return (data ?? []) as unknown as InvoiceListRow[];
}

export type InvoiceDetail = Invoice & {
  issuer: { short_name: string } | null;
  invoice_items: InvoiceItem[];
};

export async function getInvoice(
  orgId: string,
  id: string,
): Promise<InvoiceDetail | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("*, issuer:issuers(short_name), invoice_items(*)")
    .eq("org_id", orgId)
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
 *
 * The org filter is what makes a bare number safe now that numbers repeat
 * across organisations: every business can have a #1, and each one only ever
 * resolves to its own.
 */
export async function getInvoiceByRef(
  orgId: string,
  ref: string,
): Promise<InvoiceDetail | null> {
  const trimmed = ref.trim();
  if (!/^\d+$/.test(trimmed)) return getInvoice(orgId, trimmed);

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("*, issuer:issuers(short_name), invoice_items(*)")
    .eq("org_id", orgId)
    .eq("invoice_number", Number(trimmed))
    .maybeSingle();
  if (error) throw new Error(`Failed to load invoice: ${error.message}`);
  if (!data) return null;
  const detail = data as unknown as InvoiceDetail;
  detail.invoice_items.sort((a, b) => a.sort_order - b.sort_order);
  return detail;
}

/**
 * The number the next invoice WOULD receive, without taking it. Display only:
 * the definitive number is assigned atomically by the DB at insert time from
 * this organisation's own counter, so it can never collide even if the
 * dashboard and an agent create an invoice at the same moment.
 */
export async function getNextInvoiceNumber(
  orgId: string,
): Promise<number | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("peek_next_invoice_number", {
    p_org_id: orgId,
  });
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
 * splitting overdue (past the org's term) from those still within term. Overdue
 * is DERIVED here (due_date < today), never stored.
 */
export async function getOutstandingSummary(
  org: Org,
): Promise<OutstandingSummary> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("id, invoice_number, bill_to_name, balance_due, due_date, status")
    .eq("org_id", org.id)
    .eq("status", "unpaid");
  if (error) throw new Error(`Failed to load outstanding: ${error.message}`);

  // Overdue is decided in the business's own time zone, so a Perth invoice is
  // not overdue two hours early because the server thinks in Sydney time.
  const today = todayInTimezone(org.timezone);
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
 * Start of the financial year that contains `today`, as YYYY-MM-DD. Rolls over
 * on its own, so there is no config to remember every July.
 *
 * `startMonth` comes from the business (`orgs.fy_start_month`) and is 7
 * everywhere today, the Australian financial year. It is a parameter rather
 * than a constant so a business in another country is a data change.
 */
export function financialYearStart(
  today: string = todayInSydney(),
  startMonth = 7,
): string {
  const [y, m] = today.split("-").map(Number);
  // Months before the start month still belong to the FY that began last year.
  const startYear = m >= startMonth ? y : y - 1;
  return `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
}

/** "FY 2026-27" for the FY that began on the given start date. */
export function financialYearLabel(start: string): string {
  const y = Number(start.slice(0, 4));
  const month = Number(start.slice(5, 7));
  // A year that starts in January is just that calendar year.
  if (month === 1) return `FY ${y}`;
  return `FY ${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

/** Last day of the FY that began on the given start date. */
export function financialYearEnd(start: string): string {
  const [y, m] = start.split("-").map(Number);
  const end = new Date(Date.UTC(y + 1, m - 1, 1));
  end.setUTCDate(0); // the day before, i.e. the last day of the previous month
  return end.toISOString().slice(0, 10);
}

/** Same date arithmetic the financial year uses, one quarter at a time. */
function addMonths(isoFirstOfMonth: string, months: number): string {
  const [y, m] = isoFirstOfMonth.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return d.toISOString().slice(0, 10);
}

function lastDayOfMonth(isoFirstOfMonth: string): string {
  const [y, m] = isoFirstOfMonth.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

function monthsBetween(fromFirst: string, to: string): number {
  const [fy, fm] = fromFirst.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

export type GstPosition = {
  /** "Oct to Dec 2026" */
  quarterLabel: string;
  quarterStart: string;
  quarterEnd: string;
  /** When the ATO wants the BAS for that quarter. */
  dueDate: string;
  /** GST inside invoices PAID in the current quarter. */
  quarter: number;
  /** ... and in the financial year so far. */
  fy: number;
  fyLabel: string;
};

/**
 * What this business currently owes the ATO in GST.
 *
 * Counted on a cash basis: an invoice contributes when it is PAID, not when it
 * is issued, which is how most small businesses report and the only version
 * that matches the money in the account. That is why invoices carry `paid_at`.
 *
 * GST is not a per-client matter, so this is one running figure: 10% of sales
 * collected, less what was paid on purchases, which this app does not track.
 * The number here is the sales half, which is the half a billing app knows.
 */
export async function getGstPosition(org: Org): Promise<GstPosition> {
  const today = todayInTimezone(org.timezone);
  const fyStart = financialYearStart(today, org.fy_start_month);

  const quarter = Math.floor(monthsBetween(fyStart, today) / 3);
  const quarterStart = addMonths(fyStart, quarter * 3);
  const quarterEnd = lastDayOfMonth(addMonths(quarterStart, 2));

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("gst_amount, paid_at")
    .eq("org_id", org.id)
    .eq("status", "paid")
    .gte("paid_at", fyStart);
  if (error) throw new Error(`Failed to load GST: ${error.message}`);

  let fy = 0;
  let inQuarter = 0;
  for (const r of (data ?? []) as { gst_amount: number; paid_at: string }[]) {
    const amount = Number(r.gst_amount);
    fy += amount;
    if (r.paid_at >= quarterStart && r.paid_at <= quarterEnd) inQuarter += amount;
  }

  return {
    quarterLabel: `${monthName(quarterStart)} to ${monthName(quarterEnd)} ${quarterEnd.slice(0, 4)}`,
    quarterStart,
    quarterEnd,
    dueDate: basDueDate(quarterEnd),
    quarter: inQuarter,
    fy,
    fyLabel: financialYearLabel(fyStart),
  };
}

function monthName(iso: string): string {
  return [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ][Number(iso.slice(5, 7)) - 1];
}

/**
 * A quarterly BAS is due 28 days after the quarter ends, except the one ending
 * in December, which the ATO gives until 28 February because of the holidays.
 */
function basDueDate(quarterEnd: string): string {
  const [y, m] = quarterEnd.split("-").map(Number);
  if (m === 12) return `${y + 1}-02-28`;
  const due = new Date(Date.UTC(y, m, 28));
  return due.toISOString().slice(0, 10);
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
export async function getBillingTotals(org: Org): Promise<BillingTotals> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("invoice_date, total, status, issuer:issuers(short_name)")
    .eq("org_id", org.id);
  if (error) throw new Error(`Failed to load totals: ${error.message}`);

  const fyStart = financialYearStart(
    todayInTimezone(org.timezone),
    org.fy_start_month,
  );
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

    const name = r.issuer?.short_name ?? "-";
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

export async function createInvoice(
  orgId: string,
  input: NewInvoiceInput,
): Promise<Invoice> {
  const supabase = createAdminClient();
  // Atomic in the DB (awesome.create_invoice): takes the next number from this
  // organisation's counter, snapshots the client + issuer, inserts the header
  // and the items in ONE transaction, and refuses a client or issuer belonging
  // to anybody else. This is the same function every agent calls, so the rules
  // live in Postgres, not here.
  const { data, error } = await supabase.rpc("create_invoice", {
    p_client_id: input.client_id,
    p_issuer_id: input.issuer_id,
    p_invoice_date: input.invoice_date,
    p_created_by: input.created_by,
    p_items: input.items,
    p_internal_notes: input.internal_notes,
    p_org_id: orgId,
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
  orgId: string,
  id: string,
  input: UpdateInvoiceInput,
): Promise<Invoice> {
  const supabase = createAdminClient();
  // Atomic in the DB (awesome.update_invoice): re-snapshots the client + issuer
  // and fully replaces the line items in one transaction. invoice_number,
  // org_id and created_by are never touched.
  const { data, error } = await supabase.rpc("update_invoice", {
    p_id: id,
    p_client_id: input.client_id,
    p_issuer_id: input.issuer_id,
    p_invoice_date: input.invoice_date,
    p_items: input.items,
    p_internal_notes: input.internal_notes,
    p_org_id: orgId,
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
export async function deleteInvoice(orgId: string, id: string): Promise<void> {
  const supabase = createAdminClient();
  // Atomic in the DB: deletes items + invoice AND rewinds this organisation's
  // counter, so deleting the latest invoice reclaims its number. The floor is
  // the org's own starting point (1945 for Awesome, 1 for a new business).
  const { error } = await supabase.rpc("delete_invoice", {
    p_id: id,
    p_org_id: orgId,
  });
  if (error) throw new Error(`Failed to delete invoice: ${error.message}`);
}

/**
 * Mark an invoice paid in full. No partial payments: the DB sets
 * paid_amount = total and the trigger derives status = paid, balance_due = 0.
 * Rejected on a cancelled invoice (reactivate it first).
 */
export async function markPaid(orgId: string, id: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.rpc("mark_paid", {
    p_id: id,
    p_org_id: orgId,
  });
  if (error) throw new Error(`Failed to mark paid: ${error.message}`);
}

/** Undo a payment: paid_amount back to 0, status re-derived to unpaid. */
export async function markUnpaid(orgId: string, id: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.rpc("mark_unpaid", {
    p_id: id,
    p_org_id: orgId,
  });
  if (error) throw new Error(`Failed to mark unpaid: ${error.message}`);
}

/** Cancel an invoice: status = cancelled, the number is kept (never released). */
export async function cancelInvoice(orgId: string, id: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.rpc("cancel_invoice", {
    p_id: id,
    p_org_id: orgId,
  });
  if (error) throw new Error(`Failed to cancel invoice: ${error.message}`);
}

/**
 * Undo a cancellation (cancelled by mistake). The DB writes a non-cancelled
 * status so the trigger re-derives the real one from paid_amount, landing back
 * on unpaid or paid on its own.
 */
export async function reactivateInvoice(
  orgId: string,
  id: string,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.rpc("reactivate_invoice", {
    p_id: id,
    p_org_id: orgId,
  });
  if (error) throw new Error(`Failed to reactivate invoice: ${error.message}`);
}
