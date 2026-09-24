import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayInTimezone } from "@/lib/format";
import {
  financialYearEnd,
  financialYearLabel,
  financialYearStart,
} from "@/lib/data/invoices";
import type {
  DeductionCategory,
  InvoiceStatus,
  Org,
  TaxDeduction,
} from "@/lib/types";

/**
 * What each ABN has billed this financial year, and how much room is left
 * before it is taxed.
 *
 * Every figure here is per ISSUER, not per business, because that is how the
 * tax works: the two ABNs belong to two people and each one has their own
 * threshold. A business total would be the one number that answers nothing.
 *
 * The invoice is the record. `invoice_date` is what puts an invoice in a
 * financial year (there is no separate income date), a cancelled invoice is not
 * income and is skipped, and GST is taken out where there is any, because the
 * tax office's threshold is on income and GST collected was never income. With
 * no GST registration `gst_amount` is zero and the two figures are identical.
 */

/**
 * The tax-free threshold for an individual in Australia: the first $18,200 of a
 * person's income in a financial year is not taxed.
 *
 * One number in one place, so changing it when the ATO changes it is one edit.
 * It is deliberately NOT a per-business setting: it is not a decision the
 * business makes, it is the law of the country the business is in.
 */
export const TAX_FREE_THRESHOLD = 18200;

/** One invoice of the year, as the Tax page lists it. */
export type TaxInvoice = {
  id: string;
  invoice_number: number;
  invoice_date: string;
  /** Earliest service date on it, and whether there were others. */
  service_date: string | null;
  more_service_dates: number;
  client: string;
  total: number;
  status: InvoiceStatus;
};

export type TaxIssuer = {
  id: string;
  short_name: string;
  full_name: string;
  abn: string;
  acn: string | null;
  is_active: boolean;
  /** Everything issued under this ABN in the financial year, cancelled aside. */
  billed: number;
  /** Of that, what has been paid. */
  paid: number;
  /** The GST inside `billed`, which is not income. Zero without registration. */
  gst: number;
  /** billed - gst. What the threshold is read against. */
  income: number;
  invoices: number;
  /** What is left of the threshold. Zero once it has been passed. */
  room: number;
  /** How far past the threshold, when it has been passed. */
  over: number;
  /** income / threshold, as a percentage, capped at 100 for a bar. */
  percent: number;
  /** Every invoice this ABN raised in the year, newest first. */
  invoice_list: TaxInvoice[];
  /** What the accountant takes off, newest first, and its total. */
  deductions: TaxDeduction[];
  deducted: number;
  /** income - deducted. What tax would actually be worked out on. */
  taxable: number;
};

export type TaxYear = {
  fy_start: string;
  fy_end: string;
  fy_label: string;
  threshold: number;
  issuers: TaxIssuer[];
  /** The business's own totals, which no threshold applies to. */
  billed: number;
  paid: number;
  income: number;
  deducted: number;
};

export async function taxYear(org: Org, fyStart?: string): Promise<TaxYear> {
  const supabase = createAdminClient();
  const start =
    fyStart ??
    financialYearStart(todayInTimezone(org.timezone), org.fy_start_month);
  const end = financialYearEnd(start);

  // Every ABN of the business, including an archived one: it may have billed
  // earlier in the same year, and dropping it would lose that income.
  const [issuers, invoices, deductions] = await Promise.all([
    supabase
      .from("issuers")
      .select("id, short_name, full_name, abn, acn, is_active")
      .eq("org_id", org.id)
      .order("short_name"),
    supabase
      .from("invoices")
      .select(
        "id, issuer_id, invoice_number, bill_to_name, total, gst_amount, status, invoice_date, invoice_items(service_date)",
      )
      .eq("org_id", org.id)
      .gte("invoice_date", start)
      .lte("invoice_date", end)
      .order("invoice_number", { ascending: false }),
    supabase
      .from("tax_deductions")
      .select("*")
      .eq("org_id", org.id)
      .gte("spent_on", start)
      .lte("spent_on", end)
      .order("spent_on", { ascending: false }),
  ]);
  if (issuers.error) {
    throw new Error(`Failed to read the ABNs: ${issuers.error.message}`);
  }
  if (invoices.error) {
    throw new Error(`Failed to read the invoices: ${invoices.error.message}`);
  }
  if (deductions.error) {
    throw new Error(`Failed to read the deductions: ${deductions.error.message}`);
  }

  const tally = new Map<
    string,
    {
      billed: number;
      paid: number;
      gst: number;
      invoices: number;
      list: TaxInvoice[];
    }
  >();
  for (const r of (invoices.data ?? []) as unknown as {
    id: string;
    issuer_id: string;
    invoice_number: number;
    bill_to_name: string;
    total: number;
    gst_amount: number;
    status: InvoiceStatus;
    invoice_date: string;
    invoice_items: { service_date: string | null }[];
  }[]) {
    // A cancelled invoice was never income, and it is not a document any more.
    if (r.status === "cancelled") continue;
    const row =
      tally.get(r.issuer_id) ??
      { billed: 0, paid: 0, gst: 0, invoices: 0, list: [] };
    const total = Number(r.total);
    row.billed += total;
    row.gst += Number(r.gst_amount ?? 0);
    row.invoices += 1;
    if (r.status === "paid") row.paid += total;

    // The day the work was done, which is what the accountant reads, not the
    // day the invoice was raised. A monthly invoice has several, so the first
    // one is shown and the rest are counted.
    const dates = (r.invoice_items ?? [])
      .map((i) => i.service_date)
      .filter((d): d is string => Boolean(d))
      .sort();
    row.list.push({
      id: r.id,
      invoice_number: r.invoice_number,
      invoice_date: r.invoice_date,
      service_date: dates[0] ?? null,
      more_service_dates: dates.length ? new Set(dates).size - 1 : 0,
      client: r.bill_to_name,
      total,
      status: r.status,
    });
    tally.set(r.issuer_id, row);
  }

  const claims = new Map<string, TaxDeduction[]>();
  for (const d of (deductions.data ?? []) as unknown as TaxDeduction[]) {
    const row = claims.get(d.issuer_id) ?? [];
    row.push({ ...d, amount: Number(d.amount) });
    claims.set(d.issuer_id, row);
  }

  const round = (n: number) => Math.round(n * 100) / 100;

  const rows: TaxIssuer[] = (issuers.data ?? []).map((i) => {
    const t = tally.get(i.id as string) ?? {
      billed: 0,
      paid: 0,
      gst: 0,
      invoices: 0,
      list: [] as TaxInvoice[],
    };
    const mine = claims.get(i.id as string) ?? [];
    const deducted = round(mine.reduce((sum, d) => sum + d.amount, 0));
    const income = round(t.billed - t.gst);
    return {
      id: i.id as string,
      short_name: i.short_name as string,
      full_name: i.full_name as string,
      abn: i.abn as string,
      acn: (i.acn as string | null) ?? null,
      is_active: Boolean(i.is_active),
      billed: round(t.billed),
      paid: round(t.paid),
      gst: round(t.gst),
      income,
      invoices: t.invoices,
      room: round(Math.max(0, TAX_FREE_THRESHOLD - income)),
      over: round(Math.max(0, income - TAX_FREE_THRESHOLD)),
      percent: Math.min(
        100,
        Math.round((income / TAX_FREE_THRESHOLD) * 100),
      ),
      invoice_list: t.list,
      deductions: mine,
      deducted,
      // What is left once the claims come off, which is the figure tax is
      // actually worked out on. The threshold above is read against income,
      // deliberately: the deductions are the accountant's to accept.
      taxable: round(Math.max(0, income - deducted)),
    };
  });

  return {
    fy_start: start,
    fy_end: end,
    fy_label: financialYearLabel(start),
    threshold: TAX_FREE_THRESHOLD,
    issuers: rows,
    billed: round(rows.reduce((s, r) => s + r.billed, 0)),
    paid: round(rows.reduce((s, r) => s + r.paid, 0)),
    income: round(rows.reduce((s, r) => s + r.income, 0)),
    deducted: round(rows.reduce((s, r) => s + r.deducted, 0)),
  };
}

// -- what the accountant takes off -------------------------------------------

export type DeductionInput = {
  issuer_id: string;
  spent_on: string;
  amount: number;
  category: DeductionCategory;
  description: string;
  note: string | null;
  recorded_by: string | null;
};

/**
 * Record a claim against one ABN, or change one.
 *
 * The ABN has to belong to this business. Without that check the id is a number
 * the caller chose, and a claim could be filed against somebody else's ABN.
 */
export async function saveDeduction(
  orgId: string,
  input: DeductionInput,
  id?: string,
): Promise<TaxDeduction> {
  if (!(input.amount > 0)) throw new Error("The amount must be more than 0.");
  if (!input.description.trim()) throw new Error("Say what it was.");

  const supabase = createAdminClient();
  const { data: issuer } = await supabase
    .from("issuers")
    .select("id")
    .eq("org_id", orgId)
    .eq("id", input.issuer_id)
    .maybeSingle();
  if (!issuer) throw new Error("That ABN does not belong to this business.");

  const row = { ...input, org_id: orgId };
  const query = id
    ? supabase
        .from("tax_deductions")
        .update(row)
        .eq("org_id", orgId)
        .eq("id", id)
    : supabase.from("tax_deductions").insert(row);

  const { data, error } = await query.select("*").single();
  if (error) throw new Error(`Failed to save it: ${error.message}`);
  return { ...data, amount: Number(data.amount) } as TaxDeduction;
}

/** A claim entered wrongly. Nothing is derived from it, so it just goes. */
export async function deleteDeduction(
  orgId: string,
  id: string,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("tax_deductions")
    .delete()
    .eq("org_id", orgId)
    .eq("id", id);
  if (error) throw new Error(`Failed to delete it: ${error.message}`);
}

/** The claims against one ABN inside a financial year, newest first. */
export async function listDeductions(
  orgId: string,
  issuerId: string,
  from: string,
  to: string,
): Promise<TaxDeduction[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("tax_deductions")
    .select("*")
    .eq("org_id", orgId)
    .eq("issuer_id", issuerId)
    .gte("spent_on", from)
    .lte("spent_on", to)
    .order("spent_on", { ascending: false });
  if (error) throw new Error(`Failed to read the deductions: ${error.message}`);
  return (data ?? []).map((d) => ({
    ...(d as unknown as TaxDeduction),
    amount: Number(d.amount),
  }));
}
