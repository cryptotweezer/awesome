import Link from "next/link";
import { listExpenseItems } from "@/lib/data/expenses";
import { listLoans } from "@/lib/data/loans";
import { awesomeForPage } from "@/lib/data/org";
import { aud } from "@/lib/savings";
import { ExpensesManager } from "./expenses-manager";

export default async function SavingsExpensesPage() {
  const org = await awesomeForPage();
  const [items, loans] = await Promise.all([
    listExpenseItems(org.id),
    listLoans(org.id, { activeOnly: true }),
  ]);

  const active = items.filter((i) => i.is_active);
  const expenses = active.reduce((sum, i) => sum + i.weekly_amount, 0);

  // The loans live on their own page, but the money leaves in the same week, so
  // the total out per week would be a lie without them.
  const loanPayments = loans
    .filter((l) => l.balance > 0)
    .reduce((sum, l) => sum + l.weekly_payment, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Expenses
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            What a normal week costs, business and personal alike. None of this
            reaches an invoice, a statement or the tax report.
          </p>
        </div>
        <div className="flex gap-3">
          <Stat label="Expenses" value={aud(expenses)} />
          <Stat
            label="Loans"
            value={aud(loanPayments)}
            href={loanPayments > 0 ? "/savings/loans" : undefined}
          />
          <Stat label="Out per week" value={aud(expenses + loanPayments)} />
        </div>
      </div>

      <ExpensesManager items={items} />
    </div>
  );
}

function Stat({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  const body = (
    <>
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
        {value}
      </p>
    </>
  );

  const shell =
    "rounded-2xl bg-white px-5 py-3 text-right shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800";

  if (href) {
    return (
      <Link href={href} className={`${shell} block transition hover:ring-slate-300 dark:hover:ring-slate-700`}>
        {body}
      </Link>
    );
  }
  return <div className={shell}>{body}</div>;
}
