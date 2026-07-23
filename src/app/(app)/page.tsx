import Link from "next/link";
import { getOutstandingSummary } from "@/lib/data/invoices";
import { formatAUD, formatDate } from "@/lib/format";

export default async function OverviewPage() {
  const {
    totalAmount,
    totalCount,
    overdueAmount,
    overdueCount,
    currentAmount,
    currentCount,
    byClient,
  } = await getOutstandingSummary();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Overview
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Awesome Cleaning billing at a glance.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <p className="text-sm font-medium text-slate-500">Outstanding total</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">
            {formatAUD(totalAmount)}
          </p>
          <p className="mt-3 text-sm text-slate-400">
            {totalCount} {totalCount === 1 ? "invoice" : "invoices"} awaiting
            payment
          </p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-rose-200">
          <p className="text-sm font-medium text-rose-500">Overdue</p>
          <p className="mt-2 text-3xl font-bold text-rose-500">
            {formatAUD(overdueAmount)}
          </p>
          <p className="mt-3 text-sm text-slate-400">
            {overdueCount} past the 7-day term
          </p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-sky-200">
          <p className="text-sm font-medium text-sky-600">Within term</p>
          <p className="mt-2 text-3xl font-bold text-sky-600">
            {formatAUD(currentAmount)}
          </p>
          <p className="mt-3 text-sm text-slate-400">
            {currentCount} not yet due
          </p>
        </div>
      </div>

      <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-sm font-semibold text-slate-700">
            Clients with outstanding balances
          </h2>
          <span className="text-xs font-medium text-slate-400">
            {byClient.length} {byClient.length === 1 ? "client" : "clients"}
          </span>
        </div>

        {byClient.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">
            🎉 Nothing outstanding — every invoice is paid or cancelled.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {byClient.map((c) => (
              <li key={c.client_name} className="px-6 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">
                      {c.client_name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {c.count} pending {c.count === 1 ? "invoice" : "invoices"}
                      {c.overdueCount > 0 && (
                        <span className="text-rose-500">
                          {" "}
                          · {c.overdueCount} overdue
                        </span>
                      )}
                    </p>
                  </div>
                  <span className="shrink-0 font-semibold text-slate-900 tabular-nums">
                    {formatAUD(c.amount)}
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  {c.invoices.map((inv) => (
                    <Link
                      key={inv.id}
                      href={`/invoices/${inv.id}`}
                      title={`${formatAUD(inv.amount)} · due ${formatDate(inv.due_date)}`}
                      className={`rounded-md px-2 py-0.5 text-xs font-medium tabular-nums ring-1 transition ${
                        inv.overdue
                          ? "bg-rose-50 text-rose-600 ring-rose-200 hover:bg-rose-100"
                          : "bg-sky-50 text-sky-600 ring-sky-200 hover:bg-sky-100"
                      }`}
                    >
                      #{inv.invoice_number}
                    </Link>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
