import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  VaultEntry,
  VaultMovement,
  VaultName,
  VaultStatus,
} from "@/lib/types";

/**
 * The vault, which is the only place that says what has actually been saved.
 *
 * A week's excess and a week's saving are not the same number. The week works
 * out what it should have left over; closing it confirms what really went in.
 * Everything here reads the confirmed figure and nothing else.
 *
 * NO BALANCE IS STORED. Vault AUS is what the closed weeks confirmed, minus what
 * has left it. Vault COL is what was sent, minus what came back. So correcting a
 * week, even months later, fixes the vault by itself: there is no second copy of
 * the same truth to fall out of step. Same reasoning as a loan's balance and an
 * overdue invoice, both derived.
 *
 * Every query carries `org_id`, which the caller never supplies.
 */

const num = (v: unknown) => Number(v ?? 0);
const round = (n: number) => Math.round(n * 100) / 100;

function normalise(row: Record<string, unknown>): VaultMovement {
  return {
    ...(row as unknown as VaultMovement),
    amount: num(row.amount),
    rate: row.rate === null || row.rate === undefined ? null : num(row.rate),
    amount_cop:
      row.amount_cop === null || row.amount_cop === undefined
        ? null
        : num(row.amount_cop),
  };
}

export async function listVaultMovements(
  orgId: string,
  limit = 200,
): Promise<VaultMovement[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("vault_movements")
    .select("*")
    .eq("org_id", orgId)
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to load the vault: ${error.message}`);
  return (data ?? []).map(normalise);
}

export async function vaultStatus(orgId: string): Promise<VaultStatus> {
  const supabase = createAdminClient();

  const [weeks, movements, loanPayments] = await Promise.all([
    // Every closed week of the business, across every plan. The vault is real
    // money: it does not start again because a plan finished.
    supabase
      .from("savings_weeks")
      .select("saved_amount, target_amount")
      .eq("org_id", orgId)
      .not("closed_at", "is", null),
    supabase
      .from("vault_movements")
      .select("kind, vault, amount, amount_cop")
      .eq("org_id", orgId),
    // A loan paid out of the vault is a loan payment that says so, not a
    // movement of its own. The loan's balance and the vault's balance read the
    // same row, which is the only way they cannot disagree.
    supabase
      .from("loan_payments")
      .select("loan_id, amount, from_vault, loans(name)")
      .eq("org_id", orgId)
      .not("from_vault", "is", null),
  ]);
  if (weeks.error) {
    throw new Error(`Failed to read the weeks: ${weeks.error.message}`);
  }
  if (movements.error) {
    throw new Error(`Failed to read the vault: ${movements.error.message}`);
  }
  if (loanPayments.error) {
    throw new Error(
      `Failed to read the loan payments: ${loanPayments.error.message}`,
    );
  }

  const fromWeeks = (weeks.data ?? []).reduce(
    (s, w) => s + num(w.saved_amount),
    0,
  );
  const targetSoFar = (weeks.data ?? []).reduce(
    (s, w) => s + num(w.target_amount),
    0,
  );

  let transferred = 0;
  let withdrawnAus = 0;
  let withdrawnCol = 0;
  let depositedAus = 0;
  let depositedCol = 0;
  let copIn = 0;
  let copOut = 0;
  // Everything ever sent, which is not the same as what is sitting there now.
  let transferCount = 0;
  let sentCop = 0;

  for (const m of movements.data ?? []) {
    const amount = num(m.amount);
    const cop = num(m.amount_cop);
    if (m.kind === "transfer") {
      transferred += amount;
      copIn += cop;
      transferCount += 1;
      sentCop += cop;
    } else if (m.kind === "withdrawal") {
      if (m.vault === "col") {
        withdrawnCol += amount;
        copOut += cop;
      } else {
        withdrawnAus += amount;
      }
    } else if (m.kind === "deposit") {
      if (m.vault === "col") {
        depositedCol += amount;
        copIn += cop;
      } else {
        depositedAus += amount;
      }
    }
  }

  let loansAus = 0;
  let loansCol = 0;
  // Per loan as well as in total: "1,400 went on loans" is a number, "1,000 to
  // the car and 400 to the visa" is the thing he actually wants to see.
  const byLoan = new Map<string, VaultStatus["loans_paid"][number]>();
  for (const p of loanPayments.data ?? []) {
    const amount = num(p.amount);
    const col = p.from_vault === "col";
    if (col) loansCol += amount;
    else loansAus += amount;

    const id = (p.loan_id as string) ?? "";
    const joined = p.loans as { name?: string } | { name?: string }[] | null;
    const name =
      (Array.isArray(joined) ? joined[0]?.name : joined?.name) ?? "A loan";
    const row =
      byLoan.get(id) ??
      { loan_id: id, name, aus: 0, col: 0, total: 0, payments: 0 };
    if (col) row.col += amount;
    else row.aus += amount;
    row.total += amount;
    row.payments += 1;
    byLoan.set(id, row);
  }

  const aus = round(
    fromWeeks + depositedAus - withdrawnAus - transferred - loansAus,
  );
  const col = round(transferred + depositedCol - withdrawnCol - loansCol);

  return {
    from_weeks: round(fromWeeks),
    weeks_closed: (weeks.data ?? []).length,
    transferred_to_col: round(transferred),
    withdrawn_aus: round(withdrawnAus),
    withdrawn_col: round(withdrawnCol),
    deposited_aus: round(depositedAus),
    deposited_col: round(depositedCol),
    loans_paid_aus: round(loansAus),
    loans_paid_col: round(loansCol),
    loans_paid: [...byLoan.values()]
      .map((r) => ({
        ...r,
        aus: round(r.aus),
        col: round(r.col),
        total: round(r.total),
      }))
      .sort((a, b) => b.total - a.total),
    transfers_to_col: transferCount,
    sent_cop: round(sentCop),
    aus,
    col,
    total: round(aus + col),
    col_cop: round(Math.max(0, copIn - copOut)),
    target_so_far: round(targetSoFar),
  };
}

/**
 * The vault's history, movements and vault-funded loan payments together.
 *
 * They are two tables because they are two different facts, but from the
 * vault's side they are one list: money that left on a day. A loan payment is
 * read-only here and edited where it belongs, on the loan, so there is one
 * place that can change it.
 */
export async function vaultLedger(
  orgId: string,
  limit = 200,
): Promise<VaultEntry[]> {
  const supabase = createAdminClient();
  const [movements, payments] = await Promise.all([
    listVaultMovements(orgId, limit),
    supabase
      .from("loan_payments")
      .select("id, loan_id, amount, from_vault, paid_on, note, recorded_by, loans(name)")
      .eq("org_id", orgId)
      .not("from_vault", "is", null)
      .order("paid_on", { ascending: false })
      .limit(limit),
  ]);
  if (payments.error) {
    throw new Error(`Failed to read the loan payments: ${payments.error.message}`);
  }

  const fromMovements: VaultEntry[] = movements.map((m) => ({
    id: m.id,
    kind: m.kind,
    vault: m.vault,
    amount: m.amount,
    rate: m.rate,
    amount_cop: m.amount_cop,
    occurred_on: m.occurred_on,
    reason: m.reason,
    note: m.note,
    recorded_by: m.recorded_by,
    loan_id: null,
  }));

  const fromLoans: VaultEntry[] = (payments.data ?? []).map((p) => {
    const loan = p.loans as { name?: string } | { name?: string }[] | null;
    const name = Array.isArray(loan) ? loan[0]?.name : loan?.name;
    return {
      id: p.id as string,
      kind: "loan_payment" as const,
      vault: (p.from_vault as VaultName) ?? "aus",
      amount: num(p.amount),
      rate: null,
      amount_cop: null,
      occurred_on: p.paid_on as string,
      // The loan's name is the reason, and it is read live rather than copied:
      // renaming a loan should rename it here too.
      reason: name ?? "A loan",
      note: (p.note as string | null) ?? null,
      recorded_by: (p.recorded_by as string | null) ?? null,
      loan_id: (p.loan_id as string) ?? null,
    };
  });

  return [...fromMovements, ...fromLoans]
    .sort((a, b) =>
      a.occurred_on === b.occurred_on
        ? 0
        : a.occurred_on < b.occurred_on
          ? 1
          : -1,
    )
    .slice(0, limit);
}

/**
 * Every bit of money that has actually LEFT the vault, with the day it left.
 *
 * Withdrawals and loan payments funded by a vault, and deliberately not the
 * transfers to Colombia: that money is still saved, it has only stopped being
 * reachable. The caller buckets these by date, which is how a plan works out
 * what it saved and kept rather than what it put away and took back out.
 */
export async function vaultOutflows(
  orgId: string,
): Promise<{ on: string; amount: number; kind: "withdrawal" | "loan" }[]> {
  const supabase = createAdminClient();
  const [withdrawals, payments] = await Promise.all([
    supabase
      .from("vault_movements")
      .select("amount, occurred_on")
      .eq("org_id", orgId)
      .eq("kind", "withdrawal"),
    supabase
      .from("loan_payments")
      .select("amount, paid_on")
      .eq("org_id", orgId)
      .not("from_vault", "is", null),
  ]);
  if (withdrawals.error) {
    throw new Error(`Failed to read the vault: ${withdrawals.error.message}`);
  }
  if (payments.error) {
    throw new Error(`Failed to read the loan payments: ${payments.error.message}`);
  }

  return [
    ...(withdrawals.data ?? []).map((r) => ({
      on: r.occurred_on as string,
      amount: num(r.amount),
      kind: "withdrawal" as const,
    })),
    ...(payments.data ?? []).map((r) => ({
      on: r.paid_on as string,
      amount: num(r.amount),
      kind: "loan" as const,
    })),
  ];
}

export type VaultMovementInput = {
  kind: VaultMovement["kind"];
  vault: VaultName;
  amount: number;
  /** Pesos per AUD. Either this or `amount_cop`; the other is worked out. */
  rate: number | null;
  amount_cop: number | null;
  occurred_on: string;
  reason: string | null;
  note: string | null;
  recorded_by: string | null;
};

/**
 * Record money moving, and refuse what the vault cannot pay.
 *
 * The refusal is the point: a transfer of 3,000 out of a vault holding 1,800 is
 * not a movement, it is a typo, and finding it later means re-reading every row
 * to work out where the balance went wrong. The message names what is there.
 */
export async function recordVaultMovement(
  orgId: string,
  input: VaultMovementInput,
): Promise<VaultMovement> {
  if (!(input.amount > 0)) throw new Error("The amount must be more than 0.");
  if (input.kind === "withdrawal" && !input.reason) {
    throw new Error("A withdrawal needs a reason.");
  }

  // Pesos: whichever of the two he had to hand, and the other follows. Wise
  // shows both, and asking for both again is asking him to do arithmetic the
  // computer is holding the numbers for.
  let rate = input.rate;
  let cop = input.amount_cop;
  if (rate && !cop) cop = round(input.amount * rate);
  else if (cop && !rate) rate = Math.round((cop / input.amount) * 10000) / 10000;

  if (input.kind !== "deposit") {
    const status = await vaultStatus(orgId);
    const source: VaultName = input.kind === "transfer" ? "aus" : input.vault;
    const available = source === "col" ? status.col : status.aus;
    if (input.amount > available + 0.005) {
      throw new Error(
        `Vault ${source.toUpperCase()} holds ${available.toFixed(2)}, ` +
          `which is less than ${input.amount.toFixed(2)}.`,
      );
    }
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("vault_movements")
    .insert({
      org_id: orgId,
      kind: input.kind,
      vault: input.kind === "transfer" ? "aus" : input.vault,
      amount: input.amount,
      rate,
      amount_cop: cop,
      occurred_on: input.occurred_on,
      reason: input.reason,
      note: input.note,
      recorded_by: input.recorded_by,
    })
    .select("*")
    .single();
  if (error) throw new Error(`Failed to record it: ${error.message}`);
  return normalise(data);
}

/** A movement entered wrongly. The balances follow on their own. */
export async function deleteVaultMovement(
  orgId: string,
  id: string,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("vault_movements")
    .delete()
    .eq("org_id", orgId)
    .eq("id", id);
  if (error) throw new Error(`Failed to delete it: ${error.message}`);
}
