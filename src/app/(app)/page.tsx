import Link from "next/link";
import { getBillingTotals, getOutstandingSummary } from "@/lib/data/invoices";
import { formatAUD, formatDate } from "@/lib/format";

export default async function OverviewPage() {
  const [
    {
      totalAmount,
      totalCount,
      overdueAmount,
      overdueCount,
      currentAmount,
      currentCount,
      byClient,
    },
    totals,
  ] = await Promise.all([getOutstandingSummary(), getBillingTotals()]);

  const fyRange = `Australian financial year: ${formatDate(totals.fyStart)} to ${formatDate(totals.fyEnd)}`;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Overview
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Awesome Services billing system
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
            Outstanding total
          </p>
          <p className="mt-2 text-3xl font-bold text-slate-900 dark:text-slate-100">
            {formatAUD(totalAmount)}
          </p>
          <p className="mt-3 text-sm text-slate-400 dark:text-slate-500">
            {totalCount} {totalCount === 1 ? "invoice" : "invoices"} awaiting
            payment
          </p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-rose-200 dark:bg-slate-900 dark:ring-rose-900/60">
          <p className="text-sm font-medium text-rose-400">Overdue</p>
          <p className="mt-2 text-3xl font-bold text-rose-400">
            {formatAUD(overdueAmount)}
          </p>
          <p className="mt-3 text-sm text-slate-400 dark:text-slate-500">
            {overdueCount} past the 7-day term
          </p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-sky-200 dark:bg-slate-900 dark:ring-sky-900/60">
          <p className="text-sm font-medium text-sky-600 dark:text-sky-400">
            Within term
          </p>
          <p className="mt-2 text-3xl font-bold text-sky-600 dark:text-sky-400">
            {formatAUD(currentAmount)}
          </p>
          <p className="mt-3 text-sm text-slate-400 dark:text-slate-500">
            {currentCount} not yet due
          </p>
        </div>
      </div>

      {/* Financial-year headline figures. Big number = this FY, all-time below. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <PeriodCard
          label="Total paid"
          fyLabel={totals.fyLabel}
          fyRange={fyRange}
          fy={totals.paid.fy}
          all={totals.paid.all}
          accent="text-emerald-600 dark:text-emerald-400"
        />
        {totals.byIssuer.map((iss) => (
          <PeriodCard
            key={iss.short_name}
            label={`Billed · ${iss.short_name}`}
            fyLabel={totals.fyLabel}
            fyRange={fyRange}
            fy={iss.total.fy}
            all={iss.total.all}
            accent="text-slate-900 dark:text-slate-100"
          />
        ))}
      </div>

      <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Clients with outstanding balances
          </h2>
          <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
            {byClient.length} {byClient.length === 1 ? "client" : "clients"}
          </span>
        </div>

        {byClient.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400 dark:text-slate-500">
            🎉 Nothing outstanding. Every invoice is paid or cancelled.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {byClient.map((c) => (
              <li key={c.client_name} className="px-6 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900 dark:text-slate-100">
                      {c.client_name}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {c.count} pending {c.count === 1 ? "invoice" : "invoices"}
                      {c.overdueCount > 0 && (
                        <span className="text-rose-400">
                          {" "}
                          · {c.overdueCount} overdue
                        </span>
                      )}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 font-semibold tabular-nums ${
                      c.overdueCount > 0
                        ? "text-rose-400"
                        : "text-slate-900 dark:text-slate-100"
                    }`}
                  >
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
                          ? "bg-rose-50 text-rose-600 ring-rose-200 hover:bg-rose-100 dark:bg-rose-950/50 dark:text-rose-300 dark:ring-rose-900 dark:hover:bg-rose-950"
                          : "bg-sky-50 text-sky-600 ring-sky-200 hover:bg-sky-100 dark:bg-sky-950/50 dark:text-sky-300 dark:ring-sky-900 dark:hover:bg-sky-950"
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

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-slate-50 p-5 ring-1 ring-slate-200 dark:bg-slate-900/50 dark:ring-slate-800">
        <div>
          <p className="font-semibold text-slate-900 dark:text-slate-100">
            Back up your business
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Everything in one file. Never lose your data.
          </p>
        </div>
        <Link
          href="/backup"
          className="shrink-0 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          Back up
        </Link>
      </div>
    </div>
  );
}

function PeriodCard({
  label,
  fyLabel,
  fyRange,
  fy,
  all,
  accent,
}: {
  label: string;
  fyLabel: string;
  /** Hover hint: the exact dates the financial year covers. */
  fyRange: string;
  fy: number;
  all: number;
  accent: string;
}) {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
          {label}
        </p>
        <span
          title={fyRange}
          className="shrink-0 cursor-help text-xs font-medium text-slate-400 underline decoration-dotted underline-offset-2 dark:text-slate-500"
        >
          {fyLabel}
        </span>
      </div>
      <p className={`mt-2 text-3xl font-bold ${accent}`}>{formatAUD(fy)}</p>
      <p className="mt-3 text-sm text-slate-400 dark:text-slate-500">
        {formatAUD(all)} all time
      </p>
    </div>
  );
}
