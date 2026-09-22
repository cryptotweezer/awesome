import { listLoanPayments, listLoans } from "@/lib/data/loans";
import { awesomeForPage } from "@/lib/data/org";
import { todayInSydney } from "@/lib/format";
import type { LoanPayment } from "@/lib/types";
import { LoansManager } from "./loans-manager";

/**
 * Loans have their own section rather than sitting under the weekly expenses.
 *
 * They look like an expense once a week and nothing like one the rest of the
 * time: an expense is a number that repeats forever, a loan has a total, a
 * balance that falls and an end. And they are the first goal, ahead of the
 * saving, which is hard to read when they are a block at the bottom of another
 * page.
 */
export default async function SavingsLoansPage() {
  const org = await awesomeForPage();
  const loans = await listLoans(org.id);

  // The payment history of each loan, so a row opens without another round
  // trip. A handful of rows per loan; this is not a list that grows.
  const histories = await Promise.all(
    loans.map((l) => listLoanPayments(org.id, l.id)),
  );
  const payments: Record<string, LoanPayment[]> = {};
  loans.forEach((l, i) => {
    payments[l.id] = histories[i];
  });

  return (
    <div className="space-y-6">
      <LoansManager loans={loans} payments={payments} today={todayInSydney()} />
    </div>
  );
}
