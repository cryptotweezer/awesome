import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { AWESOME_ORG_ID, getOrg } from "@/lib/data/org";
import { todayInTimezone } from "@/lib/format";

/**
 * A complete, restorable snapshot of ONE organisation's data, meant to live OFF
 * this database (downloaded, emailed, saved somewhere the user controls).
 *
 * Two things are excluded on purpose: agent_keys, which hold key hashes and
 * never belong in a backup, and anything belonging to another organisation.
 * Before the multi-tenant migration this function did an unfiltered `select *`
 * on five tables, which as a guest-facing tool would have handed the whole
 * database to whoever asked.
 *
 * THE SAVINGS HALF IS INCLUDED where it exists, which today is Awesome alone.
 * It is the same button and the same tool: a second "back up everything" next to
 * the first would be two things to remember and, for a guest, two buttons doing
 * the identical job. A business with no savings plan simply has no savings
 * sections, and nothing about a guest's backup changes.
 */
export type Backup = {
  meta: {
    app: string;
    version: number;
    /** UTC timestamp the snapshot was taken. */
    generated_at: string;
    /** Sydney calendar date, for the filename and human reading. */
    date: string;
    org_id: string;
    org_name: string;
  };
  org: unknown;
  issuers: unknown[];
  clients: unknown[];
  invoices: unknown[];
  invoice_items: unknown[];
  /**
   * The savings plan, for the business that has one. Absent for everybody else,
   * rather than present and empty: an empty section reads as data that was lost.
   */
  savings?: {
    plans: unknown[];
    weeks: unknown[];
    week_entries: unknown[];
    week_expenses: unknown[];
    expense_items: unknown[];
    loans: unknown[];
    loan_payments: unknown[];
    vault_movements: unknown[];
  };
  counts: Record<string, number>;
};

/** Which businesses have a savings plan to back up. Today: organisation #1. */
function hasSavings(orgId: string): boolean {
  return orgId === AWESOME_ORG_ID;
}

export async function createBackup(orgId: string): Promise<Backup> {
  const supabase = createAdminClient();

  const [org, issuers, clients, invoices, items] = await Promise.all([
    getOrg(orgId),
    supabase.from("issuers").select("*").eq("org_id", orgId).order("short_name"),
    supabase.from("clients").select("*").eq("org_id", orgId).order("name"),
    supabase
      .from("invoices")
      .select("*")
      .eq("org_id", orgId)
      .order("invoice_number"),
    supabase.from("invoice_items").select("*").eq("org_id", orgId),
  ]);

  for (const r of [issuers, clients, invoices, items]) {
    if (r.error) throw new Error(`Backup failed: ${r.error.message}`);
  }
  if (!org) throw new Error(`Backup failed: organisation ${orgId} not found`);

  const savings = hasSavings(orgId) ? await savingsSections(orgId) : null;

  return {
    meta: {
      app: "awesome-billing",
      // 3 added the savings sections, for the business that has them.
      version: 3,
      generated_at: new Date().toISOString(),
      date: todayInTimezone(org.timezone),
      org_id: org.id,
      org_name: org.name,
    },
    org,
    issuers: issuers.data ?? [],
    clients: clients.data ?? [],
    invoices: invoices.data ?? [],
    invoice_items: items.data ?? [],
    ...(savings ? { savings: savings.data } : {}),
    counts: {
      issuers: issuers.data?.length ?? 0,
      clients: clients.data?.length ?? 0,
      invoices: invoices.data?.length ?? 0,
      invoice_items: items.data?.length ?? 0,
      ...(savings ? savings.counts : {}),
    },
  };
}

/**
 * Everything the savings half holds, for a business that has one.
 *
 * Every table with an `org_id`, in the order a restore would need them: the
 * plans, their weeks, the work and the costs recorded on those weeks, the
 * standing costs, the loans with their payments, and the vault's movements. The
 * vault's BALANCE is not here and never will be: it is worked out from the weeks
 * and these movements, so a backup that carried it could contradict itself.
 *
 * `deleted_plans` is left out on purpose. It is a thirty-day bin, not data: a
 * restore of it would put back a plan somebody deleted.
 */
async function savingsSections(orgId: string) {
  const supabase = createAdminClient();
  const table = (name: string, order: string) =>
    supabase.from(name).select("*").eq("org_id", orgId).order(order);

  const [
    plans,
    weeks,
    entries,
    costs,
    expenseItems,
    loans,
    loanPayments,
    vault,
  ] = await Promise.all([
    table("savings_plans", "starts_on"),
    table("savings_weeks", "week_start"),
    table("week_entries", "week_id"),
    table("week_expenses", "week_id"),
    table("expense_items", "name"),
    table("loans", "name"),
    table("loan_payments", "paid_on"),
    table("vault_movements", "occurred_on"),
  ]);

  const all = {
    savings_plans: plans,
    savings_weeks: weeks,
    week_entries: entries,
    week_expenses: costs,
    expense_items: expenseItems,
    loans,
    loan_payments: loanPayments,
    vault_movements: vault,
  };
  for (const [name, r] of Object.entries(all)) {
    if (r.error) throw new Error(`Backup failed on ${name}: ${r.error.message}`);
  }

  return {
    data: {
      plans: plans.data ?? [],
      weeks: weeks.data ?? [],
      week_entries: entries.data ?? [],
      week_expenses: costs.data ?? [],
      expense_items: expenseItems.data ?? [],
      loans: loans.data ?? [],
      loan_payments: loanPayments.data ?? [],
      vault_movements: vault.data ?? [],
    },
    counts: Object.fromEntries(
      Object.entries(all).map(([name, r]) => [name, r.data?.length ?? 0]),
    ) as Record<string, number>,
  };
}
