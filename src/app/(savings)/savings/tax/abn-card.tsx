"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { DEDUCTION_CATEGORIES, aud, deductionLabel, shortDate } from "@/lib/savings";
import type { TaxIssuer } from "@/lib/data/tax";
import {
  deleteDeductionAction,
  saveDeductionAction,
  type ActionState,
} from "./actions";

const initial: ActionState = { ok: false };

/**
 * One ABN's year: what it billed, how much room is left on it, and the two lists
 * behind that, its invoices and what the accountant will take off.
 *
 * Both lists are folded away. Open, they are the year in full; closed, the card
 * is the one thing being asked, which is how close this person is to being taxed.
 */
export function AbnCard({
  issuer,
  threshold,
  fyStart,
  today,
}: {
  issuer: TaxIssuer;
  threshold: number;
  /** The financial year on screen, for the statement link. */
  fyStart: string;
  today: string;
}) {
  const [open, setOpen] = useState<null | "invoices" | "expenses">(null);
  const [adding, setAdding] = useState(false);

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
            {issuer.invoices} {issuer.invoices === 1 ? "invoice" : "invoices"}
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
        {issuer.deducted > 0 && (
          <>
            <Line
              label="Expenses to claim"
              value={`- ${aud(issuer.deducted)}`}
            />
            <div className="border-t border-slate-100 pt-1.5 dark:border-slate-800">
              <Line label="Left after them" value={aud(issuer.taxable)} strong />
            </div>
          </>
        )}
      </dl>

      {/* The two lists, one at a time: the card is read for its headline, and
          two open tables underneath would bury it. */}
      <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
        <Toggle
          on={open === "invoices"}
          onClick={() => setOpen(open === "invoices" ? null : "invoices")}
          label="Invoices"
          count={issuer.invoice_list.length}
        />
        <Toggle
          on={open === "expenses"}
          onClick={() => setOpen(open === "expenses" ? null : "expenses")}
          label="Expenses"
          count={issuer.deductions.length}
        />
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            onClick={() => {
              setOpen("expenses");
              setAdding(true);
            }}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            + Expense
          </button>
          {/* The same PDF the Statements page builds, for this ABN and this
              year: one document to forward to the accountant. */}
          <a
            href={`/statements/fy/${issuer.id}/pdf?fy=${fyStart}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
          >
            Tax statement
          </a>
        </div>
      </div>

      {open === "invoices" && <Invoices rows={issuer.invoice_list} />}

      {open === "expenses" && (
        <Deductions
          issuer={issuer}
          today={today}
          adding={adding}
          onAdd={() => setAdding(true)}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}

function Toggle({
  on,
  onClick,
  label,
  count,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
        on
          ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
          : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
      }`}
    >
      {on ? "▾" : "▸"} {label}
      <span className={on ? "ml-1 opacity-70" : "ml-1 text-slate-400"}>
        {count}
      </span>
    </button>
  );
}

/** The year's invoices: the number opens the invoice, the service date is the day worked. */
function Invoices({ rows }: { rows: TaxIssuer["invoice_list"] }) {
  if (rows.length === 0) {
    return (
      <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
        Nothing billed under this ABN this year.
      </p>
    );
  }

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
          <tr>
            <th className="py-1 font-medium">Invoice</th>
            <th className="py-1 font-medium">Service</th>
            <th className="py-1 font-medium">Client</th>
            <th className="py-1 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="py-2">
                <Link
                  href={`/invoices/${r.id}`}
                  className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                >
                  #{r.invoice_number}
                </Link>
              </td>
              <td className="py-2 text-slate-600 dark:text-slate-400">
                {r.service_date ? shortDate(r.service_date) : "–"}
                {r.more_service_dates > 0 && (
                  <span className="ml-1 text-slate-400 dark:text-slate-500">
                    +{r.more_service_dates}
                  </span>
                )}
              </td>
              <td className="py-2 text-slate-600 dark:text-slate-400">
                {r.client}
              </td>
              <td className="py-2 text-right font-medium text-slate-900 dark:text-slate-100">
                {aud(r.total)}
                {r.status !== "paid" && (
                  <span className="ml-1 text-[10px] font-normal text-amber-600 dark:text-amber-400">
                    unpaid
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** What the accountant takes off, and the form to add to it. */
function Deductions({
  issuer,
  today,
  adding,
  onAdd,
  onClose,
}: {
  issuer: TaxIssuer;
  today: string;
  adding: boolean;
  onAdd: () => void;
  onClose: () => void;
}) {
  return (
    <div className="mt-3">
      {issuer.deductions.length === 0 ? (
        <p className="text-xs text-slate-400 dark:text-slate-500">
          Nothing to claim yet under this ABN. What goes here is what the
          accountant takes off: fuel, tools, insurance, fees.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
              <tr>
                <th className="py-1 font-medium">Day</th>
                <th className="py-1 font-medium">What</th>
                <th className="py-1 font-medium">Kind</th>
                <th className="py-1 text-right font-medium">Amount</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {issuer.deductions.map((d) => (
                <tr key={d.id}>
                  <td className="whitespace-nowrap py-2 text-slate-600 dark:text-slate-400">
                    {shortDate(d.spent_on)}
                  </td>
                  <td className="py-2 text-slate-900 dark:text-slate-100">
                    {d.description}
                    {d.note && (
                      <span className="ml-2 text-[10px] text-slate-400 dark:text-slate-500">
                        {d.note}
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-slate-600 dark:text-slate-400">
                    {deductionLabel(d.category)}
                  </td>
                  <td className="whitespace-nowrap py-2 text-right font-medium text-slate-900 dark:text-slate-100">
                    {aud(d.amount)}
                  </td>
                  <td className="py-2 text-right">
                    <DeleteDeduction id={d.id} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 dark:border-slate-700">
                <td className="py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Together
                </td>
                <td />
                <td />
                <td className="py-2 text-right font-bold text-slate-900 dark:text-slate-100">
                  {aud(issuer.deducted)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {adding ? (
        <DeductionForm
          issuerId={issuer.id}
          today={today}
          onClose={onClose}
        />
      ) : (
        <button
          onClick={onAdd}
          className="mt-3 w-full rounded-lg border border-dashed border-slate-300 py-2 text-xs font-medium text-slate-400 transition hover:border-slate-400 hover:text-slate-600 dark:border-slate-700 dark:text-slate-500 dark:hover:border-slate-600 dark:hover:text-slate-300"
        >
          + Something to claim
        </button>
      )}
    </div>
  );
}

function DeductionForm({
  issuerId,
  today,
  onClose,
}: {
  issuerId: string;
  today: string;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(saveDeductionAction, initial);

  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  return (
    <form action={action} className="mt-3 space-y-2">
      <input type="hidden" name="issuer_id" value={issuerId} />

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            What was it
          </span>
          <input
            name="description"
            required
            autoFocus
            placeholder="Fuel, mop, insurance"
            className="input"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Amount
            </span>
            <input
              name="amount"
              type="number"
              step="0.01"
              min="0.01"
              required
              className="input"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Day
            </span>
            <input
              name="spent_on"
              type="date"
              defaultValue={today}
              className="input"
            />
          </label>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Kind
          </span>
          <select name="category" defaultValue="supplies" className="input">
            {DEDUCTION_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Note
          </span>
          <input name="note" className="input" />
        </label>
      </div>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900">
          {state.error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          {pending ? "Saving…" : "Add it"}
        </button>
      </div>
    </form>
  );
}

function DeleteDeduction({ id }: { id: string }) {
  const [state, action, pending] = useActionState(
    deleteDeductionAction,
    initial,
  );
  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        title={state.error ?? "Delete this expense"}
        className="rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-60 dark:hover:bg-red-950/40 dark:hover:text-red-400"
      >
        {pending ? "…" : "×"}
      </button>
    </form>
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
