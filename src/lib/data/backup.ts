import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayInSydney } from "@/lib/format";

/**
 * A complete, restorable snapshot of the business data, meant to live OFF this
 * database (downloaded, emailed, saved somewhere the user controls). Secrets are
 * excluded on purpose: agent_keys hold key hashes and never belong in a backup.
 */
export type Backup = {
  meta: {
    app: string;
    version: number;
    /** UTC timestamp the snapshot was taken. */
    generated_at: string;
    /** Sydney calendar date, for the filename and human reading. */
    date: string;
  };
  company_profile: unknown[];
  issuers: unknown[];
  clients: unknown[];
  invoices: unknown[];
  invoice_items: unknown[];
  counts: Record<string, number>;
};

export async function createBackup(): Promise<Backup> {
  const supabase = createAdminClient();

  const [company, issuers, clients, invoices, items] = await Promise.all([
    supabase.from("company_profile").select("*"),
    supabase.from("issuers").select("*").order("short_name"),
    supabase.from("clients").select("*").order("name"),
    supabase.from("invoices").select("*").order("invoice_number"),
    supabase.from("invoice_items").select("*"),
  ]);

  for (const r of [company, issuers, clients, invoices, items]) {
    if (r.error) throw new Error(`Backup failed: ${r.error.message}`);
  }

  return {
    meta: {
      app: "awesome-billing",
      version: 1,
      generated_at: new Date().toISOString(),
      date: todayInSydney(),
    },
    company_profile: company.data ?? [],
    issuers: issuers.data ?? [],
    clients: clients.data ?? [],
    invoices: invoices.data ?? [],
    invoice_items: items.data ?? [],
    counts: {
      issuers: issuers.data?.length ?? 0,
      clients: clients.data?.length ?? 0,
      invoices: invoices.data?.length ?? 0,
      invoice_items: items.data?.length ?? 0,
    },
  };
}
