import Link from "next/link";
import { listInvoices } from "@/lib/data/invoices";
import { orgForPage } from "@/lib/data/org";
import { todayInTimezone } from "@/lib/format";
import { HistoryTable } from "./history-table";

export default async function HistoryPage() {
  const org = await orgForPage();
  const invoices = await listInvoices(org.id);
  const today = todayInTimezone(org.timezone);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            History
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Historical data
          </p>
        </div>
        <Link
          href="/invoices/new"
          className="shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          + New invoice
        </Link>
      </div>

      <HistoryTable invoices={invoices} today={today} />
    </div>
  );
}
