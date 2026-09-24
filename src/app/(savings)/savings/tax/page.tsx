import Link from "next/link";
import { awesomeForPage } from "@/lib/data/org";
import { taxYear, type TaxIssuer } from "@/lib/data/tax";
import { aud, shortDate } from "@/lib/savings";

/**
 * How much each ABN has billed this financial year, and how close it is to being
 * taxed.
 *
 * Per person, never per business, because that is how the tax works: the two
 * ABNs belong to two people and each one has their own tax-free threshold. A
 * combined total would be the one figure that answers nothing.
 *
 * It reads the invoices and nothing else. The savings side of the app is the
 * household's money and has no place in a tax conversation: cash work, the
 * weekly costs and the vault are not income and never appear here.
 */
export default async function SavingsTaxPage() {
  const org = await awesomeForPage();
  const year = await taxYear(org);

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Tax
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Financial year {year.fy_label}: {shortDate(year.fy_start)} to{" "}
            {shortDate(year.fy_end)}. Every invoice raised in it, by ABN.
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Tax-free threshold
          </p>
          <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            {aud(year.threshold)}
          </p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            each person, each year
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {year.issuers.map((issuer) => (
          <AbnCard key={issuer.id} issuer={issuer} threshold={year.threshold} />
        ))}
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Both ABNs together
        </h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          What the business billed this year. No threshold applies to this
          figure: it belongs to two people, and each of them is taxed on their
          own.
        </p>
        <dl className="mt-3 space-y-1.5">
          <Line label="Billed" value={aud(year.billed)} strong />
          <Line label="Of that, paid" value={aud(year.paid)} />
          {year.billed !== year.income && (
            <Line
              label="Income, GST taken out"
              value={aud(year.income)}
              muted
            />
          )}
        </dl>
      </div>

      {/* Said plainly, because the number on this page is not the whole story
          and a page that implies it is would be worse than no page. */}
      <div className="rounded-2xl bg-slate-100 p-5 text-xs leading-relaxed text-slate-600 ring-1 ring-slate-200 dark:bg-slate-900/60 dark:text-slate-400 dark:ring-slate-800">
        <p className="font-semibold text-slate-700 dark:text-slate-300">
          What this is, and what it is not
        </p>
        <p className="mt-2">
          The threshold is on a PERSON&apos;S whole income for the year, not on
          one ABN. A wage from another job, interest, anything else invoiced
          elsewhere: all of it counts towards the same {aud(year.threshold)}, and
          none of it is in this app. So read the room below as the part this
          business can still bill under that ABN, not as a balance with the tax
          office.
        </p>
        <p className="mt-2">
          An invoice counts in the year of its{" "}
          <span className="font-medium">invoice date</span>, cancelled invoices
          are left out, and a deduction is not counted at all: expenses live on
          the savings side of this app and are the household&apos;s, not the
          business&apos;s.{" "}
          <Link
            href="/statements"
            className="font-medium underline underline-offset-2"
          >
            Statements
          </Link>{" "}
          has the per-ABN tax statement to send an accountant.
        </p>
      </div>
    </div>
  );
}

function AbnCard({
  issuer,
  threshold,
}: {
  issuer: TaxIssuer;
  threshold: number;
}) {
  const over = issuer.over > 0;
  const close = !over && issuer.percent >= 80;

  return (
    <div
      className={`rounded-2xl bg-white p-5 shadow-sm ring-1 dark:bg-slate-900 ${
        over
          ? "ring-2 ring-red-300 dark:ring-red-900"
          : close
            ? "ring-2 ring-amber-300 dark:ring-amber-900"
            : "ring-slate-200 dark:ring-slate-800"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
            {issuer.short_name}
            {!issuer.is_active && (
              <span className="ml-2 text-[11px] font-normal text-slate-400 dark:text-slate-500">
                archived
              </span>
            )}
          </p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            {issuer.full_name}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
            ABN {issuer.abn}
            {issuer.acn && ` · ACN ${issuer.acn}`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            {aud(issuer.income)}
          </p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            {issuer.invoices}{" "}
            {issuer.invoices === 1 ? "invoice" : "invoices"} this year
          </p>
        </div>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div
          className={`h-full rounded-full ${
            over ? "bg-red-500" : close ? "bg-amber-500" : "bg-emerald-500"
          }`}
          style={{ width: `${issuer.percent}%` }}
        />
      </div>

      <p className="mt-2 text-sm">
        {over ? (
          <span className="font-semibold text-red-600 dark:text-red-400">
            {aud(issuer.over)} over the threshold
          </span>
        ) : (
          <>
            <span
              className={`font-semibold ${
                close
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-emerald-600 dark:text-emerald-400"
              }`}
            >
              {aud(issuer.room)} left
            </span>
            <span className="text-slate-500 dark:text-slate-400">
              {" "}
              of {aud(threshold)}
            </span>
          </>
        )}
      </p>

      <dl className="mt-4 space-y-1.5 border-t border-slate-100 pt-3 dark:border-slate-800">
        <Line label="Billed" value={aud(issuer.billed)} />
        <Line label="Of that, paid" value={aud(issuer.paid)} />
        {issuer.gst > 0 && (
          <Line label="GST inside it" value={`- ${aud(issuer.gst)}`} muted />
        )}
      </dl>
    </div>
  );
}

function Line({
  label,
  value,
  strong = false,
  muted = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt
        className={`text-sm ${
          muted
            ? "text-slate-400 dark:text-slate-500"
            : "text-slate-700 dark:text-slate-300"
        }`}
      >
        {label}
      </dt>
      <dd
        className={`text-sm ${strong ? "font-bold" : "font-medium"} ${
          muted
            ? "text-slate-400 dark:text-slate-500"
            : "text-slate-900 dark:text-slate-100"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
