import { createAdminClient } from "@/lib/supabase/admin";
import { orgForPage } from "@/lib/data/org";

async function getCounts(orgId: string) {
  const s = createAdminClient();
  const head = { count: "exact" as const, head: true };
  const [inv, cli, iss] = await Promise.all([
    s.from("invoices").select("*", head).eq("org_id", orgId),
    s.from("clients").select("*", head).eq("org_id", orgId),
    s.from("issuers").select("*", head).eq("org_id", orgId),
  ]);
  return {
    invoices: inv.count ?? 0,
    clients: cli.count ?? 0,
    issuers: iss.count ?? 0,
  };
}

export default async function BackupPage() {
  const org = await orgForPage();
  const counts = await getCounts(org.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Backup
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          A full copy of your business, in one file you keep off the database
        </p>
      </div>

      <div className="rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-sm ring-1 ring-slate-200 dark:ring-slate-800">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Your backup, one click away
        </h2>
        <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
          Everything in one file. Never lose your data.
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <a
            href="/backup/excel"
            className="group flex items-center justify-between gap-3 rounded-xl bg-slate-900 px-5 py-4 text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
          >
            <span>
              <span className="block text-sm font-semibold">
                Download as Excel
              </span>
              <span className="block text-xs opacity-70">
                Spreadsheet, easy to read
              </span>
            </span>
            <span aria-hidden="true" className="text-lg">
              ↓
            </span>
          </a>

          <a
            href="/backup/download"
            className="group flex items-center justify-between gap-3 rounded-xl px-5 py-4 text-slate-900 ring-1 ring-slate-300 transition hover:bg-slate-50 dark:text-slate-100 dark:ring-slate-700 dark:hover:bg-slate-800"
          >
            <span>
              <span className="block text-sm font-semibold">Download backup</span>
              <span className="block text-xs text-slate-400 dark:text-slate-500">
                Full file, restorable (JSON)
              </span>
            </span>
            <span aria-hidden="true" className="text-lg">
              ↓
            </span>
          </a>
        </div>

        <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">
          {counts.invoices} invoices · {counts.clients} clients ·{" "}
          {counts.issuers} ABNs
        </p>
      </div>

      <div className="rounded-2xl bg-slate-50 dark:bg-slate-900/50 p-4 text-sm text-slate-600 dark:text-slate-400 ring-1 ring-slate-200 dark:ring-slate-800">
        Any AI can back this up for you, just ask. Automatic email backups every
        15 days arrive once the system is deployed.
      </div>
    </div>
  );
}
