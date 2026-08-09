import {
  listStatementTargets,
  listFinancialYears,
} from "@/lib/data/statements";
import { listIssuers } from "@/lib/data/issuers";
import { requireOrg } from "@/lib/data/org";
import { ClientStatementPicker } from "./statement-picker";
import { FyStatementPicker } from "./fy-picker";

export default async function StatementsPage() {
  const { org } = await requireOrg();
  const [targets, years, issuers] = await Promise.all([
    listStatementTargets(org),
    listFinancialYears(org),
    listIssuers(org.id),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Statements
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Printable summaries
        </p>
      </div>

      <section className="rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-sm ring-1 ring-slate-200 dark:ring-slate-800">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Client payment reminders
        </h2>
        <p className="mt-1 mb-5 text-sm text-slate-500 dark:text-slate-400">
          Every unpaid invoice a client holds
        </p>
        <ClientStatementPicker targets={targets} />
      </section>

      <section className="rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-sm ring-1 ring-slate-200 dark:ring-slate-800">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Tax statements
        </h2>
        <p className="mt-1 mb-5 text-sm text-slate-500 dark:text-slate-400">
          Every invoice one ABN issued in a financial year
        </p>
        <FyStatementPicker
          issuers={issuers.map((i) => ({
            id: i.id,
            short_name: i.short_name,
            abn: i.abn,
          }))}
          years={years}
        />
      </section>
    </div>
  );
}
