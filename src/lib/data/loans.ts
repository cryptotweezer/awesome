import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { vaultStatus } from "@/lib/data/vault";
import type { Loan, LoanPayment, LoanWithBalance, VaultName } from "@/lib/types";

/**
 * Loans, and what is left of them.
 *
 * The balance is computed here rather than stored: principal minus the payments
 * recorded against it. Two copies of the same number is how a ledger starts
 * lying, and the payments are the record worth keeping.
 *
 * Every query carries `org_id`, which the caller never supplies.
 */

const num = (v: unknown) => Number(v ?? 0);

function withBalance(loan: Loan, paid: number): LoanWithBalance {
  const balance = Math.max(0, loan.principal - paid);
  return {
    ...loan,
    paid,
    balance,
    weeks_left:
      loan.weekly_payment > 0 ? Math.ceil(balance / loan.weekly_payment) : null,
  };
}

export async function listLoans(
  orgId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<LoanWithBalance[]> {
  const supabase = createAdminClient();

  let query = supabase.from("loans").select("*").eq("org_id", orgId);
  if (opts.activeOnly) query = query.eq("is_active", true);
  const { data, error } = await query.order("sort_order").order("name");
  if (error) throw new Error(`Failed to load loans: ${error.message}`);

  const loans = (data ?? []).map((r) => ({
    ...r,
    principal: num(r.principal),
    weekly_payment: num(r.weekly_payment),
  })) as Loan[];
  if (loans.length === 0) return [];

  // One round trip for every payment of this business, summed in memory. The
  // table holds a handful of rows per loan; a query per loan would be slower
  // and no clearer.
  const { data: payments, error: payError } = await supabase
    .from("loan_payments")
    .select("loan_id, amount")
    .eq("org_id", orgId);
  if (payError) {
    throw new Error(`Failed to load loan payments: ${payError.message}`);
  }

  const paidByLoan = new Map<string, number>();
  for (const p of payments ?? []) {
    paidByLoan.set(p.loan_id, (paidByLoan.get(p.loan_id) ?? 0) + num(p.amount));
  }

  return loans.map((l) => withBalance(l, paidByLoan.get(l.id) ?? 0));
}

export async function getLoan(
  orgId: string,
  id: string,
): Promise<LoanWithBalance | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("loans")
    .select("*")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load loan: ${error.message}`);
  if (!data) return null;

  const { data: payments } = await supabase
    .from("loan_payments")
    .select("amount")
    .eq("org_id", orgId)
    .eq("loan_id", id);

  const paid = (payments ?? []).reduce((sum, p) => sum + num(p.amount), 0);
  return withBalance(
    {
      ...data,
      principal: num(data.principal),
      weekly_payment: num(data.weekly_payment),
    } as Loan,
    paid,
  );
}

export async function listLoanPayments(
  orgId: string,
  loanId: string,
): Promise<LoanPayment[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("loan_payments")
    .select("*")
    .eq("org_id", orgId)
    .eq("loan_id", loanId)
    .order("paid_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to load payments: ${error.message}`);
  return (data ?? []).map((r) => ({
    ...r,
    amount: num(r.amount),
  })) as LoanPayment[];
}

export type LoanInput = {
  name: string;
  principal: number;
  weekly_payment: number;
  started_on: string | null;
  ends_on: string | null;
  notes: string | null;
};

export async function createLoan(
  orgId: string,
  input: LoanInput,
): Promise<Loan> {
  const supabase = createAdminClient();
  const { data: last } = await supabase
    .from("loans")
    .select("sort_order")
    .eq("org_id", orgId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("loans")
    .insert({ ...input, org_id: orgId, sort_order: (last?.sort_order ?? 0) + 1 })
    .select("*")
    .single();
  if (error) throw new Error(`Failed to add loan: ${error.message}`);
  return data as Loan;
}

export type LoanPatch = Partial<LoanInput> & { is_active?: boolean };

export async function updateLoan(
  orgId: string,
  id: string,
  input: LoanPatch,
): Promise<Loan> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("loans")
    .update(input)
    .eq("org_id", orgId)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`Failed to update loan: ${error.message}`);
  return data as Loan;
}

/** Deleting a loan takes its payments with it: they mean nothing on their own. */
export async function deleteLoan(orgId: string, id: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("loans")
    .delete()
    .eq("org_id", orgId)
    .eq("id", id);
  if (error) throw new Error(`Failed to delete loan: ${error.message}`);
}

export type LoanPaymentInput = {
  loan_id: string;
  amount: number;
  /**
   * Which vault the money came out of, or null for the ordinary case: paid out
   * of the week's money, with the saving untouched.
   */
  from_vault: VaultName | null;
  paid_on: string;
  note: string | null;
  recorded_by: string | null;
};

export async function recordLoanPayment(
  orgId: string,
  input: LoanPaymentInput,
): Promise<LoanPayment> {
  const supabase = createAdminClient();

  // The loan has to belong to this business. Without this check the loan_id is
  // a number the caller chose, and a payment could be filed against somebody
  // else's loan.
  const { data: loan } = await supabase
    .from("loans")
    .select("id")
    .eq("org_id", orgId)
    .eq("id", input.loan_id)
    .maybeSingle();
  if (!loan) throw new Error(`Loan ${input.loan_id} not found`);

  // Paying a loan out of the saving is allowed, paying it out of a saving that
  // is not there is a typo. The vault's balance is the closed weeks minus what
  // has left them, and this payment is about to be part of what has left.
  if (input.from_vault) {
    const status = await vaultStatus(orgId);
    const available = input.from_vault === "col" ? status.col : status.aus;
    if (input.amount > available + 0.005) {
      throw new Error(
        `Vault ${input.from_vault.toUpperCase()} holds ${available.toFixed(2)}, ` +
          `which is less than ${input.amount.toFixed(2)}.`,
      );
    }
  }

  const { data, error } = await supabase
    .from("loan_payments")
    .insert({ ...input, org_id: orgId })
    .select("*")
    .single();
  if (error) throw new Error(`Failed to record payment: ${error.message}`);
  return { ...data, amount: num(data.amount) } as LoanPayment;
}

/** A payment entered wrongly. The balance follows on its own. */
export async function deleteLoanPayment(
  orgId: string,
  id: string,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("loan_payments")
    .delete()
    .eq("org_id", orgId)
    .eq("id", id);
  if (error) throw new Error(`Failed to delete payment: ${error.message}`);
}
