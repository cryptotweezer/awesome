import { awesomeForPage } from "@/lib/data/org";
import { taxYear } from "@/lib/data/tax";
import { todayInSydney } from "@/lib/format";
import { aud, shortDate } from "@/lib/savings";
import { AbnCard } from "./abn-card";

/**
 * How much each ABN has billed this financial year, and how close it is to being
 * taxed.
 *
 * Per person, never per business, because that is how the tax works: the two
 * ABNs belong to two people and each one has their own tax-free threshold. A
 * combined total would be the one figure that answers nothing, which is why
 * there is no total on this page.
 *
 * It reads the invoices and the claims against each ABN, and nothing else. The
 * savings side of the app is the household's money and has no place in a tax
 * conversation: cash work, the weekly costs and the vault are not income and
 * never appear here.
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
          <AbnCard
            key={issuer.id}
            issuer={issuer}
            threshold={year.threshold}
            fyStart={year.fy_start}
            today={todayInSydney()}
          />
        ))}
      </div>
    </div>
  );
}
