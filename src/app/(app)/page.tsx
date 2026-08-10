import Link from "next/link";
import {
  getBillingTotals,
  getGstPosition,
  getOutstandingSummary,
} from "@/lib/data/invoices";
import { getCurrentOrg } from "@/lib/data/org";
import { formatAUD, formatDate } from "@/lib/format";
import { ReplayTour } from "@/components/tour/dashboard-tour";

export default async function OverviewPage() {
  const ctx = await getCurrentOrg();
  // No business yet: the same page, at zero, with the tour running over it.
  // This is the only page that renders without one, and the only place other
  // than Business details you can be while there is none.
  if (!ctx) return <EmptyOverview />;

  const org = ctx.org;
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
    gst,
  ] = await Promise.all([
    getOutstandingSummary(org),
    getBillingTotals(org),
    org.gst_registered ? getGstPosition(org) : null,
  ]);

  const fyRange = `Australian financial year: ${formatDate(totals.fyStart)} to ${formatDate(totals.fyEnd)}`;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Overview
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {org.display_name ?? org.name} billing system
        </p>
      </div>

      <TotalsRow
        outstanding={totalAmount}
        outstandingCount={totalCount}
        overdue={overdueAmount}
        overdueCount={overdueCount}
        current={currentAmount}
        currentCount={currentCount}
        termsDays={org.terms_days}
      />

      {gst && (
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-violet-200 dark:bg-slate-900 dark:ring-violet-900/60">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-medium text-violet-600 dark:text-violet-400">
              GST collected
            </p>
            <span className="shrink-0 text-xs font-medium text-slate-400 dark:text-slate-500">
              {gst.quarterLabel}
            </span>
          </div>
          <p className="mt-2 text-3xl font-bold text-violet-600 dark:text-violet-400">
            {formatAUD(gst.quarter)}
          </p>
          <p className="mt-3 text-sm text-slate-400 dark:text-slate-500">
            {formatAUD(gst.fy)} so far in {gst.fyLabel} · BAS due{" "}
            {formatDate(gst.dueDate)}
          </p>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            From invoices your clients have paid. What you paid in GST on your
            own purchases comes off this in your BAS.
          </p>
        </div>
      )}

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

      {/* The things you do once, kept off the top navigation on purpose. */}
      {org.is_demo && (
        <ActionCard
          tour="ai"
          title="Let your AI do the billing"
          body="Connect your own assistant in a few minutes, or take the whole system with you."
          href="/guide"
          label="Open the guide"
          primary
        />
      )}

      <ActionCard
        tour="backup"
        title="Back up your business"
        body="Everything in one file. Never lose your data."
        href="/backup"
        label="Back up"
        primary
      />

      <ActionCard
        tour="keys"
        title="Agent keys"
        body="One key per AI agent. Revoke any of them anytime."
        href="/agent-keys"
        label="Manage keys"
      />

      <ActionCard
        tour="business"
        title="Business details"
        body="Your address, bank details and payment terms, as they appear on every document."
        href="/settings"
        label="Edit details"
      />

      {org.is_demo && (
        <div className="text-center">
          <ReplayTour />
        </div>
      )}
    </div>
  );
}

/**
 * The dashboard of a business that does not exist yet: every figure at zero and
 * every button switched off, except the one that creates it.
 *
 * Showing the real thing empty, rather than a sign-up form, is the whole point.
 * A person can see what they are about to fill in before they are asked for
 * their ABN, and the tour has something to point at.
 */
function EmptyOverview() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Overview
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          This is your dashboard. It fills in as you use it.
        </p>
      </div>

      <TotalsRow
        outstanding={0}
        outstandingCount={0}
        overdue={0}
        overdueCount={0}
        current={0}
        currentCount={0}
        termsDays={7}
      />

      <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Clients with outstanding balances
          </h2>
        </div>
        <p className="px-6 py-10 text-center text-sm text-slate-400 dark:text-slate-500">
          Nobody owes you anything yet.
        </p>
      </div>

      <ActionCard
        tour="ai"
        title="Let your AI do the billing"
        body="Connect your own assistant in a few minutes, or take the whole system with you."
        href="/guide"
        label="Open the guide"
        primary
        disabled
      />

      <ActionCard
        tour="backup"
        title="Back up your business"
        body="Everything in one file. Never lose your data."
        href="/backup"
        label="Back up"
        primary
        disabled
      />

      <ActionCard
        tour="keys"
        title="Agent keys"
        body="One key per AI agent. Revoke any of them anytime."
        href="/agent-keys"
        label="Manage keys"
        disabled
      />

      <ActionCard
        tour="business"
        title="Business details"
        body="Start here. Your name, your ABN and how you get paid, printed on every invoice you send."
        href="/settings"
        label="Create your business"
        primary
      />
    </div>
  );
}

function TotalsRow({
  outstanding,
  outstandingCount,
  overdue,
  overdueCount,
  current,
  currentCount,
  termsDays,
}: {
  outstanding: number;
  outstandingCount: number;
  overdue: number;
  overdueCount: number;
  current: number;
  currentCount: number;
  termsDays: number;
}) {
  return (
    <div data-tour="totals" className="grid gap-4 sm:grid-cols-3">
      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
          Outstanding total
        </p>
        <p className="mt-2 text-3xl font-bold text-slate-900 dark:text-slate-100">
          {formatAUD(outstanding)}
        </p>
        <p className="mt-3 text-sm text-slate-400 dark:text-slate-500">
          {outstandingCount} {outstandingCount === 1 ? "invoice" : "invoices"}{" "}
          awaiting payment
        </p>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-rose-200 dark:bg-slate-900 dark:ring-rose-900/60">
        <p className="text-sm font-medium text-rose-400">Overdue</p>
        <p className="mt-2 text-3xl font-bold text-rose-400">
          {formatAUD(overdue)}
        </p>
        <p className="mt-3 text-sm text-slate-400 dark:text-slate-500">
          {overdueCount} past the {termsDays}-day term
        </p>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-sky-200 dark:bg-slate-900 dark:ring-sky-900/60">
        <p className="text-sm font-medium text-sky-600 dark:text-sky-400">
          Within term
        </p>
        <p className="mt-2 text-3xl font-bold text-sky-600 dark:text-sky-400">
          {formatAUD(current)}
        </p>
        <p className="mt-3 text-sm text-slate-400 dark:text-slate-500">
          {currentCount} not yet due
        </p>
      </div>
    </div>
  );
}

/** One of the "do this once" rows under the dashboard. */
function ActionCard({
  tour,
  title,
  body,
  href,
  label,
  primary,
  disabled,
}: {
  tour: string;
  title: string;
  body: string;
  href: string;
  label: string;
  primary?: boolean;
  disabled?: boolean;
}) {
  const solid =
    "shrink-0 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300";
  const outline =
    "shrink-0 rounded-lg px-4 py-2.5 text-sm font-medium text-slate-700 ring-1 ring-slate-300 transition hover:bg-white dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-800";

  return (
    <div
      data-tour={tour}
      className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-slate-50 p-5 ring-1 ring-slate-200 dark:bg-slate-900/50 dark:ring-slate-800"
    >
      <div>
        <p className="font-semibold text-slate-900 dark:text-slate-100">
          {title}
        </p>
        <p className="text-sm text-slate-500 dark:text-slate-400">{body}</p>
      </div>
      {disabled ? (
        <span
          aria-disabled="true"
          title="Create your business first"
          className="shrink-0 cursor-not-allowed rounded-lg px-4 py-2.5 text-sm font-medium text-slate-400 ring-1 ring-slate-200 dark:text-slate-600 dark:ring-slate-800"
        >
          {label}
        </span>
      ) : (
        <Link href={href} className={primary ? solid : outline}>
          {label}
        </Link>
      )}
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
