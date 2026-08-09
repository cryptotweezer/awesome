import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Thin wrappers over the `awesome` read functions. They exist so the gateway
 * (and anything else server-side) calls one implementation with narrow,
 * agent-friendly output. Overdue and financial-year logic live in the DB.
 *
 * Every one of these takes `orgId` first and passes it straight through. The DB
 * function filters on it before anything else, which matters most for the four
 * that match names with a loose `ilike`: without the org filter, searching for
 * "a" would return every client in the database, whoever they belong to.
 */

export type WhoOwesRow = {
  client_name: string;
  invoice_count: number;
  amount: number;
  overdue_count: number;
  overdue_amount: number;
};

export async function whoOwes(orgId: string): Promise<WhoOwesRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("who_owes", { p_org_id: orgId });
  if (error) throw new Error(`who_owes failed: ${error.message}`);
  return (data ?? []) as WhoOwesRow[];
}

export type ClientAccountRow = {
  client_name: string;
  invoice_number: number;
  invoice_date: string;
  due_date: string;
  total: number;
  balance_due: number;
  overdue: boolean;
};

export async function clientAccount(
  orgId: string,
  name: string,
): Promise<ClientAccountRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("client_account", {
    p_name: name,
    p_org_id: orgId,
  });
  if (error) throw new Error(`client_account failed: ${error.message}`);
  return (data ?? []) as ClientAccountRow[];
}

export type RecentInvoiceRow = {
  invoice_number: number;
  client_name: string;
  issuer: string;
  invoice_date: string;
  total: number;
  status: string;
};

export async function recentInvoices(
  orgId: string,
  name?: string | null,
  limit?: number | null,
): Promise<RecentInvoiceRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("recent_invoices", {
    p_name: name ?? null,
    p_limit: limit ?? 10,
    p_org_id: orgId,
  });
  if (error) throw new Error(`recent_invoices failed: ${error.message}`);
  return (data ?? []) as RecentInvoiceRow[];
}

export type BilledInPeriodRow = {
  issuer: string;
  invoice_count: number;
  billed: number;
};

export async function billedInPeriod(
  orgId: string,
  from: string,
  to: string,
  issuer?: string | null,
): Promise<BilledInPeriodRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("billed_in_period", {
    p_from: from,
    p_to: to,
    p_issuer: issuer ?? null,
    p_org_id: orgId,
  });
  if (error) throw new Error(`billed_in_period failed: ${error.message}`);
  return (data ?? []) as BilledInPeriodRow[];
}

export type FySummaryRow = {
  issuer: string;
  abn: string;
  billed: number;
  paid: number;
};

export async function fySummary(
  orgId: string,
  fyStart?: string | null,
): Promise<FySummaryRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("fy_summary", {
    p_fy_start: fyStart ?? null,
    p_org_id: orgId,
  });
  if (error) throw new Error(`fy_summary failed: ${error.message}`);
  return (data ?? []) as FySummaryRow[];
}

export type BusinessSnapshot = {
  outstanding_amount: number;
  outstanding_count: number;
  overdue_amount: number;
  overdue_count: number;
  billed_this_month: number;
  billed_this_fy: number;
  billed_all_time: number;
  paid_all_time: number;
};

export async function businessSnapshot(
  orgId: string,
): Promise<BusinessSnapshot | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("business_snapshot", {
    p_org_id: orgId,
  });
  if (error) throw new Error(`business_snapshot failed: ${error.message}`);
  const rows = (data ?? []) as BusinessSnapshot[];
  return rows[0] ?? null;
}

export type OverdueInvoiceRow = {
  invoice_number: number;
  client_name: string;
  issuer: string;
  due_date: string;
  days_overdue: number;
  balance_due: number;
};

export async function overdueInvoices(
  orgId: string,
): Promise<OverdueInvoiceRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("overdue_invoices", {
    p_org_id: orgId,
  });
  if (error) throw new Error(`overdue_invoices failed: ${error.message}`);
  return (data ?? []) as OverdueInvoiceRow[];
}

export type ClientSummaryRow = {
  client_name: string;
  billed_all_time: number;
  paid_all_time: number;
  outstanding: number;
  unpaid_count: number;
  overdue_count: number;
  last_invoice_date: string | null;
};

export async function clientSummary(
  orgId: string,
  name: string,
): Promise<ClientSummaryRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("client_summary", {
    p_name: name,
    p_org_id: orgId,
  });
  if (error) throw new Error(`client_summary failed: ${error.message}`);
  return (data ?? []) as ClientSummaryRow[];
}

export type FindInvoicesFilters = {
  client?: string | null;
  issuer?: string | null;
  status?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number | null;
};

export type FindInvoiceRow = {
  invoice_number: number;
  client_name: string;
  issuer: string;
  invoice_date: string;
  due_date: string;
  total: number;
  balance_due: number;
  status: string;
};

export async function findInvoices(
  orgId: string,
  f: FindInvoicesFilters,
): Promise<FindInvoiceRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("find_invoices", {
    p_client: f.client ?? null,
    p_issuer: f.issuer ?? null,
    p_status: f.status ?? null,
    p_from: f.from ?? null,
    p_to: f.to ?? null,
    p_limit: f.limit ?? 20,
    p_org_id: orgId,
  });
  if (error) throw new Error(`find_invoices failed: ${error.message}`);
  return (data ?? []) as FindInvoiceRow[];
}
