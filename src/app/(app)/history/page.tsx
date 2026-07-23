import Link from "next/link";
import { listInvoices } from "@/lib/data/invoices";
import { HistoryTable } from "./history-table";

export default async function HistoryPage() {
  const invoices = await listInvoices();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            History
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Every invoice issued, oldest first. Filter by client, status or ABN.
          </p>
        </div>
        <Link
          href="/invoices/new"
          className="shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
        >
          + New invoice
        </Link>
      </div>

      <HistoryTable invoices={invoices} />
    </div>
  );
}
