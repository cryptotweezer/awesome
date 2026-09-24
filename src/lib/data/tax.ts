import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayInTimezone } from "@/lib/format";
import {
  financialYearEnd,
  financialYearLabel,
  financialYearStart,
} from "@/lib/data/invoices";
import type { InvoiceStatus, Org } from "@/lib/types";

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
};

export async function taxYear(org: Org, fyStart?: string): Promise<TaxYear> {
  const supabase = createAdminClient();
  const start =
    fyStart ??
    financialYearStart(todayInTimezone(org.timezone), org.fy_start_month);
  const end = financialYearEnd(start);

  // Every ABN of the business, including an archived one: it may have billed
  // earlier in the same year, and dropping it would lose that income.
  const [issuers, invoices] = await Promise.all([
    supabase
      .from("issuers")
      .select("id, short_name, full_name, abn, acn, is_active")
      .eq("org_id", org.id)
      .order("short_name"),
    supabase
      .from("invoices")
      .select("issuer_id, total, gst_amount, status, invoice_date")
      .eq("org_id", org.id)
      .gte("invoice_date", start)
      .lte("invoice_date", end),
  ]);
  if (issuers.error) {
    throw new Error(`Failed to read the ABNs: ${issuers.error.message}`);
  }
  if (invoices.error) {
    throw new Error(`Failed to read the invoices: ${invoices.error.message}`);
  }

  const tally = new Map<
    string,
    { billed: number; paid: number; gst: number; invoices: number }
  >();
  for (const r of (invoices.data ?? []) as unknown as {
    issuer_id: string;
    total: number;
    gst_amount: number;
    status: InvoiceStatus;
  }[]) {
    // A cancelled invoice was never income, and it is not a document any more.
    if (r.status === "cancelled") continue;
    const row =
      tally.get(r.issuer_id) ?? { billed: 0, paid: 0, gst: 0, invoices: 0 };
    const total = Number(r.total);
    row.billed += total;
    row.gst += Number(r.gst_amount ?? 0);
    row.invoices += 1;
    if (r.status === "paid") row.paid += total;
    tally.set(r.issuer_id, row);
  }

  const round = (n: number) => Math.round(n * 100) / 100;

  const rows: TaxIssuer[] = (issuers.data ?? []).map((i) => {
    const t = tally.get(i.id as string) ?? {
      billed: 0,
      paid: 0,
      gst: 0,
      invoices: 0,
    };
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
  };
}
