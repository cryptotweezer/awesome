"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { aud, cop, shortDate } from "@/lib/savings";
import type { LoanWithBalance, VaultEntry, VaultStatus } from "@/lib/types";
import { recordLoanPaymentAction } from "../loans/actions";
import {
  deleteVaultMovementAction,
  recordVaultMovementAction,
  type ActionState,
} from "./actions";

const initial: ActionState = { ok: false };

/** Which form is open, since each one asks for different things. */
type Form = "transfer" | "withdrawal" | "deposit" | "loan";

/**
 * The vault.
 *
 * Two balances and a history, and no way to type a balance in: a balance here is
 * the sum of the weeks that closed and the movements below, which is why
 * correcting a week from three months ago fixes this screen by itself.
 *
 * Vault AUS is money that is saved but still reachable. Vault COL is money that
 * has left the country, so it is shown beside the pesos it turned into, at the
 * rate of the day it was sent.
 */
export function VaultManager({
  status,
  ledger,
  loans,
  today,
}: {
  status: VaultStatus;
  /** Movements and vault-funded loan payments, newest first. */
  ledger: VaultEntry[];
  /** The loans still owed, so one can be paid out of the saving. */
  loans: LoanWithBalance[];
  today: string;
}) {
  const [form, setForm] = useState<Form | null>(null);

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Vault
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            What has actually been saved. A week&apos;s excess says what it
            should leave over; this is what it left.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setForm("transfer")}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
          >
            Send to Colombia
          </button>
          <button
            onClick={() => setForm("withdrawal")}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Take money out
          </button>
          <button
            onClick={() => setForm("deposit")}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Put money in
          </button>
          {loans.length > 0 && (
            <button
              onClick={() => setForm("loan")}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Pay a loan
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Balance
          label="Vault AUS"
          hint="saved, and still reachable"
          value={aud(status.aus)}
        />
        {/* Colombia is read in pesos: that is the figure that means something
            there, and the AUD is what it cost to put there. With no rate
            recorded yet there are no pesos to show, so it falls back to AUD. */}
        <Balance
          label="Vault COL"
          hint="frozen"
          value={status.col_cop > 0 ? cop(status.col_cop) : aud(status.col)}
          second={
            status.col_cop > 0 ? `${aud(status.col)} · frozen` : undefined
          }
        />
        <Balance
          label="Total saved"
          hint={`${status.weeks_closed} ${
            status.weeks_closed === 1 ? "week" : "weeks"
          } closed`}
          value={aud(status.total)}
          strong
        />
      </div>

      {/* Where the money went, which is the part that is not already above.
          The balances are the two cards; repeating them here as a sum was the
          confusing half. What cannot be seen anywhere else is how much has gone
          to Colombia over the whole plan, and which debts the rest paid off. */}
      {(status.transferred_to_col > 0 ||
        status.loans_paid.length > 0 ||
        status.withdrawn_aus > 0 ||
        status.withdrawn_col > 0) && (
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Where it has gone
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Everything that has left the vault since the plan began.
          </p>

          <dl className="mt-3 space-y-1.5">
            {status.transferred_to_col > 0 && (
              <>
                <Line
                  label="Sent to Colombia"
                  value={aud(status.transferred_to_col)}
                  strong
                />
                <Line
                  label={`${status.transfers_to_col} ${
                    status.transfers_to_col === 1 ? "transfer" : "transfers"
                  }`}
                  value={status.sent_cop > 0 ? cop(status.sent_cop) : ""}
                  muted
                />
              </>
            )}

            {status.loans_paid.length > 0 && (
              <div className="border-t border-slate-100 pt-1.5 dark:border-slate-800">
                <Line
                  label="Paid off debts"
                  value={aud(status.loans_paid_aus + status.loans_paid_col)}
                  strong
                />
                {status.loans_paid.map((l) => (
                  <Line
                    key={l.loan_id}
                    label={`${l.name}${
                      l.col > 0 && l.aus > 0
                        ? " (AUS and COL)"
                        : l.col > 0
                          ? " (out of COL)"
                          : ""
                    }`}
                    value={aud(l.total)}
                    muted
                  />
                ))}
              </div>
            )}

            {(status.withdrawn_aus > 0 || status.withdrawn_col > 0) && (
              <div className="border-t border-slate-100 pt-1.5 dark:border-slate-800">
                <Line
                  label="Taken out for something else"
                  value={aud(status.withdrawn_aus + status.withdrawn_col)}
                  tone="bad"
                  strong
                />
              </div>
            )}
          </dl>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3 font-medium">Day</th>
              <th className="px-4 py-3 font-medium">What happened</th>
              <th className="px-4 py-3 text-right font-medium">AUD</th>
              <th className="px-4 py-3 text-right font-medium">Rate</th>
              <th className="px-4 py-3 text-right font-medium">Pesos</th>
              <th className="px-4 py-3 font-medium">Why</th>
              <th className="px-4 py-3 text-right font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {ledger.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-slate-400 dark:text-slate-500"
                >
                  Nothing has moved yet. Every week you close adds to Vault AUS
                  on its own; this list is for money leaving it.
                </td>
              </tr>
            )}
            {ledger.map((e) => (
              <LedgerRow key={`${e.kind}-${e.id}`} entry={e} />
            ))}
          </tbody>
        </table>
      </div>

      {form === "loan" && (
        <LoanPaymentDialog
          loans={loans}
          status={status}
          today={today}
          onClose={() => setForm(null)}
        />
      )}
      {form !== null && form !== "loan" && (
        <MovementDialog
          kind={form}
          status={status}
          today={today}
          onClose={() => setForm(null)}
        />
      )}
    </section>
  );
}

function LedgerRow({ entry: m }: { entry: VaultEntry }) {
  const [state, action, pending] = useActionState(
    deleteVaultMovementAction,
    initial,
  );

  const loan = m.kind === "loan_payment";
  const what =
    m.kind === "transfer"
      ? "Sent to Vault COL"
      : m.kind === "withdrawal"
        ? `Taken out of Vault ${m.vault.toUpperCase()}`
        : m.kind === "deposit"
          ? `Put into Vault ${m.vault.toUpperCase()}`
          : `Loan paid out of Vault ${m.vault.toUpperCase()}`;

  return (
    <tr>
      <td className="whitespace-nowrap px-4 py-3 text-slate-500 dark:text-slate-400">
        {shortDate(m.occurred_on)}
      </td>
      <td className="px-4 py-3 text-slate-900 dark:text-slate-100">
        {what}
        {m.recorded_by && (
          <span className="ml-2 text-[11px] text-slate-400 dark:text-slate-500">
            {m.recorded_by}
          </span>
        )}
      </td>
      <td
        className={`whitespace-nowrap px-4 py-3 text-right font-medium ${
          m.kind === "deposit"
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-slate-900 dark:text-slate-100"
        }`}
      >
        {aud(m.amount)}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right text-slate-500 dark:text-slate-400">
        {m.rate ? m.rate.toLocaleString("en-AU") : "–"}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right text-slate-500 dark:text-slate-400">
        {m.amount_cop ? cop(m.amount_cop) : "–"}
      </td>
      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
        {m.reason ?? m.note ?? "–"}
        {m.reason && m.note && (
          <span className="ml-2 text-[11px] text-slate-400 dark:text-slate-500">
            {m.note}
          </span>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right">
        {/* A loan payment is edited where it lives, on the loan, so there is one
            place that can change it and no chance of the two disagreeing. */}
        {loan ? (
          <Link
            href="/savings/loans"
            className="rounded-md px-2 py-1 text-xs font-medium text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            On the loan
          </Link>
        ) : (
          <form action={action} className="inline">
            <input type="hidden" name="id" value={m.id} />
            <button
              type="submit"
              disabled={pending}
              title={state.error ?? "Delete this movement"}
              className="rounded-md px-2 py-1 text-xs font-medium text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-60 dark:hover:bg-red-950/40 dark:hover:text-red-400"
            >
              {pending ? "…" : "Delete"}
            </button>
          </form>
        )}
      </td>
    </tr>
  );
}

/**
 * One form for the three movements, because they differ by two fields.
 *
 * A transfer asks for the rate, since it is the only thing that turns AUD into
 * pesos and it cannot be looked up afterwards. A withdrawal insists on a reason.
 * A deposit asks for neither and exists to put back what an emergency took.
 */
function MovementDialog({
  kind,
  status,
  today,
  onClose,
}: {
  kind: Form;
  status: VaultStatus;
  today: string;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(
    recordVaultMovementAction,
    initial,
  );
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("");
  const [pesos, setPesos] = useState("");

  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  const title =
    kind === "transfer"
      ? "Send to Vault COL"
      : kind === "withdrawal"
        ? "Take money out"
        : "Put money in";

  // Typing the rate fills in the pesos and the other way round: Wise shows both,
  // and doing the multiplication by hand is how the two stop agreeing.
  const onAmount = (v: string) => {
    setAmount(v);
    const a = Number(v);
    const r = Number(rate);
    if (a > 0 && r > 0) setPesos(String(Math.round(a * r)));
  };
  const onRate = (v: string) => {
    setRate(v);
    const a = Number(amount);
    const r = Number(v);
    if (a > 0 && r > 0) setPesos(String(Math.round(a * r)));
  };
  const onPesos = (v: string) => {
    setPesos(v);
    const a = Number(amount);
    const p = Number(v);
    if (a > 0 && p > 0) setRate((p / a).toFixed(4));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {title}
        </h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {kind === "transfer"
            ? `Vault AUS holds ${aud(status.aus)}. What leaves it lands in Vault COL and is frozen.`
            : kind === "withdrawal"
              ? "This comes out of the saving, so the plan falls behind until it is put back."
              : "Money going in that is not a week's saving: replenishing after a withdrawal, or something from outside."}
        </p>

        <form action={action} className="mt-4 space-y-4">
          <input type="hidden" name="kind" value={kind} />
          {kind === "transfer" && (
            <input type="hidden" name="vault" value="aus" />
          )}

          <div className="grid grid-cols-2 gap-3">
            <Labelled label="Amount (AUD)" required>
              <input
                name="amount"
                type="number"
                step="0.01"
                min="0"
                required
                autoFocus
                value={amount}
                onChange={(e) => onAmount(e.target.value)}
                className="input"
              />
            </Labelled>
            <Labelled label="Day it moved">
              <input
                name="occurred_on"
                type="date"
                defaultValue={today}
                className="input"
              />
            </Labelled>
          </div>

          {kind !== "transfer" && (
            <Labelled label="Which vault" required>
              <select name="vault" defaultValue="aus" className="input">
                <option value="aus">Vault AUS ({aud(status.aus)})</option>
                <option value="col">Vault COL ({aud(status.col)})</option>
              </select>
            </Labelled>
          )}

          {kind === "transfer" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Labelled label="Rate (pesos per AUD)">
                  <input
                    name="rate"
                    type="number"
                    step="0.0001"
                    min="0"
                    value={rate}
                    onChange={(e) => onRate(e.target.value)}
                    className="input"
                  />
                </Labelled>
                <Labelled label="Pesos that arrived">
                  <input
                    name="amount_cop"
                    type="number"
                    step="1"
                    min="0"
                    value={pesos}
                    onChange={(e) => onPesos(e.target.value)}
                    className="input"
                  />
                </Labelled>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Fill either one and the other works itself out. Both belong to
                that minute on that platform, which is why they are recorded and
                never recalculated later.
              </p>
            </>
          )}

          <Labelled label="Why" required={kind === "withdrawal"}>
            <input
              name="reason"
              required={kind === "withdrawal"}
              placeholder={
                kind === "withdrawal"
                  ? "The car, the visa, whatever it really was"
                  : "Optional"
              }
              className="input"
            />
          </Labelled>

          <Labelled label="Note">
            <input name="note" className="input" />
          </Labelled>

          {state.error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900">
              {state.error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
            >
              {pending ? "Recording…" : "Record it"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Paying a loan out of the saving.
 *
 * It calls the loans page's own action, not one of the vault's: the payment is a
 * loan payment that happens to name a vault, so it is recorded once and both
 * screens read it. The same form on the Loans page can leave the vault out of
 * it, which is the ordinary case.
 */
function LoanPaymentDialog({
  loans,
  status,
  today,
  onClose,
}: {
  loans: LoanWithBalance[];
  status: VaultStatus;
  today: string;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(
    recordLoanPaymentAction,
    initial,
  );
  const [loanId, setLoanId] = useState(loans[0]?.id ?? "");
  const chosen = loans.find((l) => l.id === loanId) ?? loans[0];

  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Pay a loan from the vault
        </h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Paying a debt down with the saving is a fair use of it, not the saving
          being spent. It is recorded as a payment on the loan, and the vault
          reads it.
          A payment from somewhere else is recorded the same way and leaves both
          balances alone.
        </p>

        <form action={action} className="mt-4 space-y-4">
          <Labelled label="Which loan" required>
            <select
              name="loan_id"
              value={loanId}
              onChange={(e) => setLoanId(e.target.value)}
              className="input"
            >
              {loans.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({aud(l.balance)} owed)
                </option>
              ))}
            </select>
          </Labelled>

          <div className="grid grid-cols-2 gap-3">
            <Labelled label="Amount (AUD)" required>
              <input
                name="amount"
                type="number"
                step="0.01"
                min="0.01"
                required
                autoFocus
                defaultValue={chosen?.weekly_payment || ""}
                className="input"
              />
            </Labelled>
            <Labelled label="Paid on" required>
              <input
                name="paid_on"
                type="date"
                required
                defaultValue={today}
                className="input"
              />
            </Labelled>
          </div>

          {/* The third option is here and not only on the Loans page because a
              payment is often recorded while looking at the vault, and its
              answer is sometimes "this one did not come out of the vault". */}
          <Labelled label="Out of" required>
            <select name="from_vault" defaultValue="aus" className="input">
              <option value="aus">Vault AUS ({aud(status.aus)})</option>
              <option value="col">Vault COL ({aud(status.col)})</option>
              <option value="">Somewhere else, not the vault</option>
            </select>
          </Labelled>

          <Labelled label="Note">
            <input name="note" className="input" />
          </Labelled>

          {state.error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900">
              {state.error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
            >
              {pending ? "Recording…" : "Record the payment"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Balance({
  label,
  hint,
  value,
  second,
  strong = false,
}: {
  label: string;
  hint: string;
  value: string;
  second?: string;
  strong?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl p-5 shadow-sm ring-1 ${
        strong
          ? "bg-emerald-50 ring-emerald-200 dark:bg-emerald-950/30 dark:ring-emerald-900"
          : "bg-white ring-slate-200 dark:bg-slate-900 dark:ring-slate-800"
      }`}
    >
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p
        className={`mt-1 font-bold ${
          // A peso figure is three digits longer than an AUD one and would run
          // off the card at the same size.
          value.length > 13 ? "text-xl" : "text-2xl"
        } ${
          strong
            ? "text-emerald-700 dark:text-emerald-300"
            : "text-slate-900 dark:text-slate-100"
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        {second ?? hint}
      </p>
    </div>
  );
}

function Line({
  label,
  value,
  tone = "plain",
  strong = false,
  muted = false,
}: {
  label: string;
  value: string;
  tone?: "plain" | "bad";
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
          tone === "bad"
            ? "text-rose-600 dark:text-rose-400"
            : muted
              ? "text-slate-400 dark:text-slate-500"
              : "text-slate-900 dark:text-slate-100"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function Labelled({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
    </label>
  );
}
