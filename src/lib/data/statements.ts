import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayInTimezone } from "@/lib/format";
import {
  financialYearStart,
  financialYearEnd,
  financialYearLabel,
} from "@/lib/data/invoices";
import type { Client, InvoiceStatus, Issuer, Org } from "@/lib/types";

/**
 * Statements are DERIVED documents — computed on the fly from live invoice
 * data, never stored.
 *
 * The client statement is a payment REMINDER, not a tax document: it lists
 * everything the client still owes regardless of which ABN issued each
 * invoice. Which ABN gets used is decided per invoice, so a client normally
 * billed under one can hold invoices under the other.
 */

/** One printable line: a single service on a single outstanding invoice. */
export type StatementRow = {
  invoice_id: string;
  invoice_number: number;
  invoice_date: string;
  due_date: string;
  description: string;
  service_date: string | null;
  quantity: number;
  amount: number;
};

/** All services of one outstanding invoice, kept together on the page. */
export type StatementInvoice = {
  invoice_id: string;
  invoice_number: number;
  rows: StatementRow[];
  balance_due: number;
};

export type ClientStatement = {
  statementDate: string;
  client: Pick<
    Client,
    "name" | "address_line" | "suburb" | "state" | "postcode"
  >;
  invoices: StatementInvoice[];
  invoiceCount: number;
  total: number;
};

/** A client with something outstanding — one statement each. */
export type StatementTarget = {
  client_id: string;
  client_name: string;
  invoiceCount: number;
  amount: number;
  overdueCount: number;
};

type UnpaidRow = {
  id: string;
  invoice_number: number;
  invoice_date: string;
  due_date: string;
  balance_due: number;
  client_id: string | null;
  bill_to_name: string;
  invoice_items: {
    description: string;
    service_date: string | null;
    quantity: number;
    amount: number;
    sort_order: number;
  }[];
};

const UNPAID_SELECT =
  "id, invoice_number, invoice_date, due_date, balance_due, client_id, bill_to_name, invoice_items(description, service_date, quantity, amount, sort_order)";

/** Every client with outstanding invoices — drives the picker. */
export async function listStatementTargets(
  org: Org,
): Promise<StatementTarget[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("invoices")
    .select(UNPAID_SELECT)
    .eq("org_id", org.id)
    .eq("status", "unpaid");
  if (error) throw new Error(`Failed to load statements: ${error.message}`);

  const today = todayInTimezone(org.timezone);
  const byClient = new Map<string, StatementTarget>();

  for (const inv of (data ?? []) as unknown as UnpaidRow[]) {
    // Invoices whose client was deleted can't produce a statement — the
    // current billing address is gone. They still show up in History.
    if (!inv.client_id) continue;
    const entry =
      byClient.get(inv.client_id) ??
      ({
        client_id: inv.client_id,
        client_name: inv.bill_to_name,
        invoiceCount: 0,
        amount: 0,
        overdueCount: 0,
      } satisfies StatementTarget);
    entry.invoiceCount += 1;
    entry.amount += Number(inv.balance_due);
    if (inv.due_date < today) entry.overdueCount += 1;
    byClient.set(inv.client_id, entry);
  }

  return Array.from(byClient.values()).sort(
    (a, b) =>
      b.overdueCount - a.overdueCount ||
      b.amount - a.amount ||
      a.client_name.localeCompare(b.client_name),
  );
}

/**
 * The payment-reminder statement: every outstanding invoice this client holds,
 * across both ABNs, expanded to one row per service. Oldest invoice first so
 * the longest-standing debt reads at the top.
 */
export async function getClientStatement(
  org: Org,
  clientId: string,
): Promise<ClientStatement | null> {
  const supabase = createAdminClient();

  const [{ data: client }, { data: rows, error }] = await Promise.all([
    supabase
      .from("clients")
      .select("*")
      .eq("org_id", org.id)
      .eq("id", clientId)
      .maybeSingle(),
    supabase
      .from("invoices")
      .select(UNPAID_SELECT)
      .eq("org_id", org.id)
      .eq("status", "unpaid")
      .eq("client_id", clientId)
      .order("invoice_number", { ascending: true }),
  ]);
  if (error) throw new Error(`Failed to load statement: ${error.message}`);
  if (!client) return null;

  const unpaid = (rows ?? []) as unknown as UnpaidRow[];
  if (unpaid.length === 0) return null;

  let total = 0;
  const invoices: StatementInvoice[] = unpaid.map((inv) => {
    total += Number(inv.balance_due);
    const items = [...inv.invoice_items].sort(
      (a, b) => a.sort_order - b.sort_order,
    );
    return {
      invoice_id: inv.id,
      invoice_number: inv.invoice_number,
      balance_due: Number(inv.balance_due),
      rows: items.map((it) => ({
        invoice_id: inv.id,
        invoice_number: inv.invoice_number,
        invoice_date: inv.invoice_date,
        due_date: inv.due_date,
        description: it.description,
        service_date: it.service_date,
        quantity: Number(it.quantity),
        amount: Number(it.amount),
      })),
    };
  });

  const c = client as Client;
  return {
    statementDate: todayInTimezone(org.timezone),
    // Current client details — the statement is being sent today.
    client: {
      name: c.name,
      address_line: c.address_line,
      suburb: c.suburb,
      state: c.state,
      postcode: c.postcode,
    },
    invoices,
    invoiceCount: unpaid.length,
    total,
  };
}

/* ------------------------------------------------------------------ */
/* Financial-year statement — one ABN, for the accountant.            */
/* ------------------------------------------------------------------ */

export type FinancialYearOption = {
  /** YYYY-07-01 */
  start: string;
  label: string;
  invoiceCount: number;
};

export type FyStatementRow = {
  invoice_number: number;
  bill_to_name: string;
  bill_to_suburb: string | null;
  invoice_date: string;
  /** Earliest service date on the invoice, plus how many other dates exist. */
  service_date: string | null;
  extraServiceDates: number;
  due_date: string;
  total: number;
  status: InvoiceStatus;
};

export type FyStatement = {
  issuer: Pick<Issuer, "id" | "full_name" | "short_name" | "abn">;
  fyStart: string;
  fyEnd: string;
  fyLabel: string;
  generatedOn: string;
  rows: FyStatementRow[];
  /** Invoices that count as billed — cancelled ones are listed but excluded. */
  invoiceCount: number;
  cancelledCount: number;
  total: number;
};

/**
 * Financial years that actually hold invoices, newest first. The current year
 * is always offered even when empty, so a fresh FY can still be printed.
 */
export async function listFinancialYears(
  org: Org,
): Promise<FinancialYearOption[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("invoice_date")
    .eq("org_id", org.id);
  if (error)
    throw new Error(`Failed to load financial years: ${error.message}`);

  const month = org.fy_start_month;
  const counts = new Map<string, number>();
  counts.set(financialYearStart(todayInTimezone(org.timezone), month), 0);
  for (const r of (data ?? []) as { invoice_date: string }[]) {
    const start = financialYearStart(r.invoice_date, month);
    counts.set(start, (counts.get(start) ?? 0) + 1);
  }

  return Array.from(counts, ([start, invoiceCount]) => ({
    start,
    label: financialYearLabel(start),
    invoiceCount,
  })).sort((a, b) => b.start.localeCompare(a.start));
}

/**
 * Every invoice one ABN issued inside an Australian financial year, in invoice
 * order. Cancelled invoices are LISTED (so the accountant can see why a number
 * is missing from the sequence) but excluded from the total.
 */
export async function getFyStatement(
  org: Org,
  issuerId: string,
  fyStart: string,
): Promise<FyStatement | null> {
  const supabase = createAdminClient();
  const fyEnd = financialYearEnd(fyStart);

  const [{ data: issuer }, { data: rows, error }] = await Promise.all([
    supabase
      .from("issuers")
      .select("*")
      .eq("org_id", org.id)
      .eq("id", issuerId)
      .maybeSingle(),
    supabase
      .from("invoices")
      .select(
        "invoice_number, bill_to_name, bill_to_suburb, invoice_date, due_date, total, status, invoice_items(service_date)",
      )
      .eq("org_id", org.id)
      .eq("issuer_id", issuerId)
      .gte("invoice_date", fyStart)
      .lte("invoice_date", fyEnd)
      .order("invoice_number", { ascending: true }),
  ]);
  if (error) throw new Error(`Failed to load statement: ${error.message}`);
  if (!issuer) return null;

  type Row = {
    invoice_number: number;
    bill_to_name: string;
    bill_to_suburb: string | null;
    invoice_date: string;
    due_date: string;
    total: number;
    status: InvoiceStatus;
    invoice_items: { service_date: string | null }[];
  };

  let total = 0;
  let invoiceCount = 0;
  let cancelledCount = 0;

  const statementRows: FyStatementRow[] = (
    (rows ?? []) as unknown as Row[]
  ).map((r) => {
    if (r.status === "cancelled") {
      cancelledCount += 1;
    } else {
      total += Number(r.total);
      invoiceCount += 1;
    }
    const dates = r.invoice_items
      .map((i) => i.service_date)
      .filter((d): d is string => Boolean(d))
      .sort();
    return {
      invoice_number: r.invoice_number,
      bill_to_name: r.bill_to_name,
      bill_to_suburb: r.bill_to_suburb,
      invoice_date: r.invoice_date,
      service_date: dates[0] ?? null,
      extraServiceDates: dates.length ? new Set(dates).size - 1 : 0,
      due_date: r.due_date,
      total: Number(r.total),
      status: r.status,
    };
  });

  const iss = issuer as Issuer;
  return {
    issuer: {
      id: iss.id,
      full_name: iss.full_name,
      short_name: iss.short_name,
      abn: iss.abn,
    },
    fyStart,
    fyEnd,
    fyLabel: financialYearLabel(fyStart),
    generatedOn: todayInTimezone(org.timezone),
    rows: statementRows,
    invoiceCount,
    cancelledCount,
    total,
  };
}
