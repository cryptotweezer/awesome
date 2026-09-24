"use client";

import { useActionState, useEffect, useState } from "react";
import type { LoanPayment, LoanWithBalance } from "@/lib/types";
import { aud } from "@/lib/savings";
import {
  saveLoanAction,
  setLoanActiveAction,
  deleteLoanAction,
  recordLoanPaymentAction,
  deleteLoanPaymentAction,
  type ActionState,
} from "./actions";

const initial: ActionState = { ok: false };

/** What is owed, and how fast it is going down. */
export function LoansManager({
  loans,
  payments,
  today,
}: {
  loans: LoanWithBalance[];
  /** Every payment of every loan, keyed by loan, newest first. */
  payments: Record<string, LoanPayment[]>;
  today: string;
}) {
  const [editing, setEditing] = useState<LoanWithBalance | "new" | null>(null);
  const [paying, setPaying] = useState<LoanWithBalance | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  // A loan that is paid off drops out of the way, the same as an archived one.
  // The list at the top is what is still owed: keeping a settled loan in it
  // means reading past a finished thing every time, and the whole point of the
  // section is how much is left.
  const live = loans.filter((l) => l.is_active && l.balance > 0);
  const done = loans.filter((l) => !l.is_active || l.balance <= 0);

  const owed = live.reduce((sum, l) => sum + l.balance, 0);
  const weekly = live.reduce((sum, l) => sum + l.weekly_payment, 0);
  const longest = live.reduce(
    (max, l) => Math.max(max, l.weeks_left ?? 0),
    0,
  );

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Loans
          </h1>
          {/* The old line said saving starts once these are gone, which is not
              how it works: the debts are paid down as the weeks go by and the
              saving runs alongside them. */}
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Paid down week by week. The saving runs alongside them, not after
            them.
          </p>
        </div>
        <button
          onClick={() => setEditing("new")}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          + Add loan
        </button>
      </div>

      {/* What is owed altogether, and then loan by loan: borrowed, paid off,
          still owed. The table further down can do everything to a loan; this
          only answers how each debt is going, which is the question asked from
          the doorway. */}
      <div className="space-y-4 rounded-2xl bg-white px-5 py-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {live.length === 0
              ? "Nothing still owed."
              : `${live.length} ${live.length === 1 ? "loan" : "loans"} still being paid.`}
          </p>
          <div className="flex flex-wrap items-center gap-5">
            <Figure label="Still owed" value={aud(owed)} strong />
            <Figure label="Per week" value={aud(weekly)} />
            <Figure
              label="Weeks left"
              value={longest > 0 ? String(longest) : "–"}
            />
          </div>
        </div>

        {live.length > 0 && (
          <div className="overflow-x-auto border-t border-slate-100 pt-2 dark:border-slate-800">
            <table className="w-full text-left text-sm">
              <thead className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                <tr>
                  <th className="py-1 font-medium">Loan</th>
                  <th className="py-1 text-right font-medium">Borrowed</th>
                  <th className="py-1 text-right font-medium">Paid</th>
                  <th className="py-1 text-right font-medium">Still owed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {live.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2 font-medium text-slate-900 dark:text-slate-100">
                      {l.name}
                    </td>
                    <td className="py-2 text-right text-slate-500 dark:text-slate-400">
                      {aud(l.principal)}
                    </td>
                    <td className="py-2 text-right text-emerald-600 dark:text-emerald-400">
                      {aud(l.paid)}
                    </td>
                    <td className="py-2 text-right font-semibold text-slate-900 dark:text-slate-100">
                      {aud(l.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 dark:border-slate-700">
                  <td className="py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    Together
                  </td>
                  <td className="py-2 text-right text-slate-500 dark:text-slate-400">
                    {aud(live.reduce((sum, l) => sum + l.principal, 0))}
                  </td>
                  <td className="py-2 text-right text-emerald-600 dark:text-emerald-400">
                    {aud(live.reduce((sum, l) => sum + l.paid, 0))}
                  </td>
                  <td className="py-2 text-right font-bold text-slate-900 dark:text-slate-100">
                    {aud(owed)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3 font-medium">Loan</th>
              <th className="px-4 py-3 text-right font-medium">Borrowed</th>
              <th className="px-4 py-3 text-right font-medium">Paid</th>
              <th className="px-4 py-3 text-right font-medium">Still owed</th>
              <th className="px-4 py-3 text-right font-medium">Per week</th>
              <th className="px-4 py-3 text-right font-medium">Weeks left</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {live.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-slate-400 dark:text-slate-500"
                >
                  {loans.length === 0
                    ? "No loans. Nothing standing between you and the savings plan."
                    : "Nothing still owed. Every loan is paid off or archived."}
                </td>
              </tr>
            )}
            {live.map((l) => {
              const rows = payments[l.id] ?? [];
              return (
                <LoanRow
                  key={l.id}
                  loan={l}
                  settled={false}
                  payments={rows}
                  expanded={open === l.id}
                  onToggle={() => setOpen(open === l.id ? null : l.id)}
                  onEdit={() => setEditing(l)}
                  onPay={() => setPaying(l)}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {done.length > 0 && (
        <div className="space-y-2">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Paid off and archived
            <span className="ml-2 font-normal normal-case text-slate-400 dark:text-slate-500">
              {done.length}
            </span>
          </h2>
          <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <table className="w-full text-left text-sm">
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {done.map((l) => {
                  const rows = payments[l.id] ?? [];
                  return (
                    <LoanRow
                      key={l.id}
                      loan={l}
                      settled={l.balance <= 0}
                      payments={rows}
                      expanded={open === l.id}
                      onToggle={() => setOpen(open === l.id ? null : l.id)}
                      onEdit={() => setEditing(l)}
                      onPay={() => setPaying(l)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing !== null && (
        <LoanDialog
          loan={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {paying !== null && (
        <PaymentDialog
          loan={paying}
          today={today}
          onClose={() => setPaying(null)}
        />
      )}
    </section>
  );
}

function LoanRow({
  loan,
  settled,
  payments,
  expanded,
  onToggle,
  onEdit,
  onPay,
}: {
  loan: LoanWithBalance;
  settled: boolean;
  payments: LoanPayment[];
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onPay: () => void;
}) {
  const progress =
    loan.principal > 0
      ? Math.min(100, Math.round((loan.paid / loan.principal) * 100))
      : 100;

  return (
    <>
      {/* The whole row opens the payments. The only thing inside it that is
          not "show me this loan" is the actions cell, which stops the click
          before it gets here. */}
      <tr
        onClick={onToggle}
        title={expanded ? "Hide payments" : "Show payments"}
        className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800"
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <span
              className={`font-medium ${
                loan.is_active
                  ? "text-slate-900 dark:text-slate-100"
                  : "text-slate-400 dark:text-slate-500"
              }`}
            >
              {loan.name}
            </span>
            {settled && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                Paid off
              </span>
            )}
            {!loan.is_active && !settled && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                Archived
              </span>
            )}
          </div>
          <div className="mt-1.5 h-1 w-40 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div
              className="h-full rounded-full bg-emerald-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          {/* Spelled out rather than hidden behind a click on the name: the
              payments are the record the balance is made of, and a row that
              does not say they exist gets read as a loan nobody has paid. */}
          <span className="mt-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400">
            {expanded ? "▾" : "▸"} {payments.length}{" "}
            {payments.length === 1 ? "payment" : "payments"}
          </span>
          {(loan.started_on || loan.ends_on) && (
            <div className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              {loan.started_on && <>from {loan.started_on}</>}
              {loan.started_on && loan.ends_on && " "}
              {loan.ends_on && <>due {loan.ends_on}</>}
            </div>
          )}
          {loan.notes && (
            <div className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              {loan.notes}
            </div>
          )}
        </td>
        <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400">
          {aud(loan.principal)}
        </td>
        <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400">
          {aud(loan.paid)}
        </td>
        <td className="px-4 py-3 text-right font-semibold text-slate-900 dark:text-slate-100">
          {aud(loan.balance)}
        </td>
        <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400">
          {aud(loan.weekly_payment)}
        </td>
        <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400">
          {loan.weeks_left ?? "–"}
        </td>
        <td
          className="px-4 py-3"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-end gap-1">
            <button
              onClick={onPay}
              className="rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
            >
              Payment
            </button>
            <button
              onClick={onEdit}
              className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              Edit
            </button>
            <ArchiveLoanButton id={loan.id} active={loan.is_active} />
            <DeleteLoanButton id={loan.id} name={loan.name} />
          </div>
        </td>
      </tr>

      {expanded && (
        <tr className="bg-slate-50 dark:bg-slate-950/40">
          <td colSpan={7} className="px-4 py-4">
            {payments.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                No payments recorded yet. Use Payment, or tell an agent, and it
                lands here.
              </p>
            ) : (
              <div className="max-w-2xl overflow-x-auto rounded-xl bg-white ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 text-right font-medium">
                        Amount
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        Left after
                      </th>
                      <th className="px-3 py-2 font-medium">Note</th>
                      {/* An agent's label lands here exactly as a person's
                          name does, so the two are never in doubt. */}
                      <th className="px-3 py-2 font-medium">Recorded by</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {payments.map((p, i) => {
                      // Newest first, so what was left after this one is the
                      // principal minus everything from here down the list.
                      const after = payments
                        .slice(i)
                        .reduce((sum, q) => sum + q.amount, 0);
                      return (
                        <tr key={p.id}>
                          <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                            {p.paid_on}
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-slate-900 dark:text-slate-100">
                            {aud(p.amount)}
                            {/* Where it came from, when it was the saving.
                                Nothing shown for the ordinary case. */}
                            {p.from_vault && (
                              <span className="ml-2 text-[11px] font-normal text-slate-400 dark:text-slate-500">
                                Vault {p.from_vault.toUpperCase()}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-500 dark:text-slate-500">
                            {aud(Math.max(0, loan.principal - after))}
                          </td>
                          <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                            {p.note ?? ""}
                          </td>
                          <td className="px-3 py-2 text-slate-500 dark:text-slate-500">
                            {p.recorded_by ?? ""}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <DeletePaymentButton id={p.id} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function LoanDialog({
  loan,
  onClose,
}: {
  loan: LoanWithBalance | null;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(saveLoanAction, initial);

  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  return (
    <Dialog title={loan ? "Edit loan" : "Add loan"}>
      <form action={action} className="mt-4 space-y-4">
        {loan && <input type="hidden" name="id" value={loan.id} />}

        <Labelled label="Who it is with" required>
          <input
            name="name"
            required
            autoFocus
            defaultValue={loan?.name ?? ""}
            className="input"
          />
        </Labelled>

        <div className="grid grid-cols-2 gap-3">
          <Labelled label="Amount borrowed (AUD)" required>
            <input
              name="principal"
              type="number"
              step="0.01"
              min="0"
              required
              defaultValue={loan?.principal ?? ""}
              className="input"
            />
          </Labelled>
          <Labelled label="Paid per week (AUD)">
            <input
              name="weekly_payment"
              type="number"
              step="0.01"
              min="0"
              defaultValue={loan?.weekly_payment ?? ""}
              className="input"
            />
          </Labelled>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Labelled label="Started on">
            <input
              name="started_on"
              type="date"
              defaultValue={loan?.started_on ?? ""}
              className="input"
            />
          </Labelled>
          <Labelled label="Meant to end">
            <input
              name="ends_on"
              type="date"
              defaultValue={loan?.ends_on ?? ""}
              className="input"
            />
          </Labelled>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Both dates are optional. Leave them empty for a loan you pay whenever
          there is money for it: an invented date later reads as a fact.
        </p>

        <Labelled label="Notes">
          <input
            name="notes"
            defaultValue={loan?.notes ?? ""}
            className="input"
          />
        </Labelled>

        {loan && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Editing the amount borrowed does not touch the payments already
            recorded: the balance is worked out from them.
          </p>
        )}

        <Buttons error={state.error} pending={pending} onClose={onClose} />
      </form>
    </Dialog>
  );
}

function PaymentDialog({
  loan,
  today,
  onClose,
}: {
  loan: LoanWithBalance;
  today: string;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(
    recordLoanPaymentAction,
    initial,
  );

  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  return (
    <Dialog title={`Payment to ${loan.name}`}>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        {aud(loan.balance)} still owed. The balance follows the payments, so
        correcting one here corrects everything.
      </p>
      <form action={action} className="mt-4 space-y-4">
        <input type="hidden" name="loan_id" value={loan.id} />

        <div className="grid grid-cols-2 gap-3">
          <Labelled label="Amount (AUD)" required>
            <input
              name="amount"
              type="number"
              step="0.01"
              min="0.01"
              required
              autoFocus
              defaultValue={loan.weekly_payment || ""}
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

        {/* Where the money came from. Blank is the usual answer: the payment is
            part of what the week costs and the saving never sees it. Naming a
            vault takes it out of the saving instead, and the vault reads this
            same payment rather than keeping a movement of its own. */}
        <Labelled label="Paid out of">
          <select name="from_vault" defaultValue="" className="input">
            <option value="">Somewhere else, not the vault</option>
            <option value="aus">Vault AUS</option>
            <option value="col">Vault COL</option>
          </select>
        </Labelled>

        <Labelled label="Note">
          <input name="note" className="input" />
        </Labelled>

        <Buttons error={state.error} pending={pending} onClose={onClose} />
      </form>
    </Dialog>
  );
}

function ArchiveLoanButton({ id, active }: { id: string; active: boolean }) {
  const [state, action, pending] = useActionState(setLoanActiveAction, initial);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={active ? "false" : "true"} />
      <button
        type="submit"
        disabled={pending}
        title={
          active
            ? "Stop counting this loan. Its payments stay."
            : "Count this loan again."
        }
        className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60 dark:text-slate-400 dark:hover:bg-slate-800"
      >
        {pending ? "…" : active ? "Archive" : "Restore"}
      </button>
      {state.error && (
        <span className="text-xs text-red-600 dark:text-red-400">
          {state.error}
        </span>
      )}
    </form>
  );
}

function DeleteLoanButton({ id, name }: { id: string; name: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(deleteLoanAction, initial);

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/50"
      >
        Delete
      </button>
    );
  }

  return (
    <form action={action} className="flex items-center gap-1">
      <input type="hidden" name="id" value={id} />
      <span className="text-xs text-slate-500 dark:text-slate-400">
        Delete {name} and its payments?
      </span>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
      >
        {pending ? "…" : "Yes"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
      >
        No
      </button>
      {state.error && (
        <span className="text-xs text-red-600 dark:text-red-400">
          {state.error}
        </span>
      )}
    </form>
  );
}

function DeletePaymentButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(
    deleteLoanPaymentAction,
    initial,
  );
  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        title="Remove this payment"
        className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-60 dark:text-red-400 dark:hover:bg-red-950/50"
      >
        {pending ? "…" : "Remove"}
      </button>
      {state.error && (
        <span className="ml-1 text-[11px] text-red-600 dark:text-red-400">
          {state.error}
        </span>
      )}
    </form>
  );
}

// -- small shared pieces ----------------------------------------------------

function Dialog({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {title}
        </h2>
        {children}
      </div>
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

function Buttons({
  error,
  pending,
  onClose,
}: {
  error?: string;
  pending: boolean;
  onClose: () => void;
}) {
  return (
    <>
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900">
          {error}
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
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </>
  );
}

function Figure({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="text-right">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p
        className={`font-bold text-slate-900 dark:text-slate-100 ${
          strong ? "text-xl" : "text-base"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
