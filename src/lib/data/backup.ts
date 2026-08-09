import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrg } from "@/lib/data/org";
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
  counts: Record<string, number>;
};

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

  return {
    meta: {
      app: "awesome-billing",
      version: 2,
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
    counts: {
      issuers: issuers.data?.length ?? 0,
      clients: clients.data?.length ?? 0,
      invoices: invoices.data?.length ?? 0,
      invoice_items: items.data?.length ?? 0,
    },
  };
}
