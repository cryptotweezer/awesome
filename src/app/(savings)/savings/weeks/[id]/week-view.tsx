"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import {
  WEEKDAYS,
  appliesToWeek,
  aud,
  methodFor,
  serviceDateFor,
  shortDate,
  weekdayLabel,
} from "@/lib/savings";
import type {
  ClientWithIssuer,
  ExpenseItem,
  PaymentMethod,
  WeekDetail,
  WeekEntry,
} from "@/lib/types";
import {
  addEntryAction,
  closeWeekAction,
  deleteEntryAction,
  deleteWeekExpenseAction,
  reopenWeekAction,
  saveEntryAction,
  saveEntryExtraAction,
  saveWeekExpenseAction,
  saveWeekNotesAction,
  setEntryDayAction,
  setEntryStatusAction,
  type ActionState,
} from "../actions";

const initial: ActionState = { ok: false };

/**
 * One week, as it actually went.
 *
 * The lines arrive pre-filled from the rotation. Everything on this screen is a
 * correction to that plan: this one was not done, that one moved to Thursday,
 * there was extra work, the fuel cost more, somebody paid late.
 *
 * A closed week is shown read-only with one button to reopen it, rather than
 * locked: the point is that correcting the past is normal, not that it is
 * forbidden.
 */
export function WeekView({
  detail,
  clients,
  standing,
  today,
}: {
  detail: WeekDetail;
  clients: ClientWithIssuer[];
  standing: ExpenseItem[];
  today: string;
}) {
  const { week, state, entries, expenses } = detail;
  const closed = state === "closed";

  const byDay = new Map<number | null, WeekEntry[]>();
  for (const e of entries) {
    const key = e.day ?? null;
    byDay.set(key, [...(byDay.get(key) ?? []), e]);
  }

  return (
    <div className="space-y-6">
      <Header detail={detail} today={today} />

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <section className="space-y-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
              The work
            </h2>
            {!closed && <AddEntry weekId={week.id} clients={clients} />}
          </div>

          {entries.length === 0 && (
            <p className="rounded-2xl bg-white p-6 text-sm text-slate-500 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:ring-slate-800">
              Nothing in this week. The rotation had nobody due, or this week
              started before anyone was placed on it.
            </p>
          )}

          {[...WEEKDAYS.map((d) => d.value), null].map((day) => {
            const rows = byDay.get(day) ?? [];
            if (rows.length === 0) return null;
            return (
              <div key={String(day)} className="space-y-2">
                <h3 className="flex flex-wrap items-baseline gap-x-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <span>{weekdayLabel(day)}</span>
                  {day !== null && (
                    <span className="font-normal normal-case text-slate-400 dark:text-slate-500">
                      {shortDate(serviceDateFor(week.week_start, day))}
                    </span>
                  )}
                  {/* What the day is worth if it goes to plan, which is the
                      only figure that means anything before it has. */}
                  <span className="font-normal normal-case text-slate-500 dark:text-slate-400">
                    {aud(
                      rows
                        .filter((e) => e.status !== "skipped")
                        .reduce((s, e) => s + e.amount + e.extra_amount, 0),
                    )}
                  </span>
                </h3>
                <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
                  {rows.map((e) => (
                    <EntryRow
                      key={e.id}
                      entry={e}
                      weekId={week.id}
                      weekStart={week.week_start}
                      closed={closed}
                      today={today}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </section>

        <section className="space-y-4">
          <Expenses
            weekId={week.id}
            weekEnd={week.week_end}
            closed={closed}
            standing={standing}
            recorded={expenses}
            total={detail.expenses_total}
            detail={detail}
          />
          <Notes weekId={week.id} notes={week.notes} />
        </section>
      </div>
    </div>
  );
}

// -- header -----------------------------------------------------------------

function Header({ detail, today }: { detail: WeekDetail; today: string }) {
  const { week, state } = detail;
  const closed = state === "closed";
  // A running week is judged on what it should leave over; a closed one on what
  // was actually put away, which is the only figure the plan counts.
  const met = (closed ? detail.saved : detail.surplus) >= detail.target;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/savings/overview"
            className="text-xs font-medium text-slate-500 hover:underline dark:text-slate-400"
          >
            ← Overview
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {week.week_start} to {week.week_end}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Week {week.rotation_week} ·{" "}
            {closed ? (
              <>
                Target {aud(detail.target)} · saved{" "}
                <span
                  className={
                    met
                      ? "font-semibold text-emerald-600 dark:text-emerald-400"
                      : "font-semibold text-red-600 dark:text-red-400"
                  }
                >
                  {aud(detail.saved)}
                </span>{" "}
                · closed by {week.closed_by ?? "somebody"}
              </>
            ) : state === "pending" ? (
              "Ended, waiting on money"
            ) : (
              "Running"
            )}
          </p>
        </div>

        {/* The week in the order the money actually moves: what comes in
            without an invoice, what has to be billed, the two together, what
            goes out, and what survives. Every figure here is the week as it is
            meant to go, not only what has landed. */}
        <div className="flex flex-wrap items-center gap-5">
          <Figure label="Cash" value={aud(detail.cash_in)} />
          <Figure label="Billed" value={aud(detail.invoiced_in)} />
          <Figure label="Total" value={aud(detail.expected_income)} />
          <Figure
            label="Out"
            value={aud(detail.expenses_total)}
            tone={closed ? "plain" : "out"}
          />
          {/* Once the week is closed these are history and stop shouting. The
              only question left is whether the target was met, so the target is
              the one figure that keeps a colour. */}
          <Figure
            label="Excess"
            value={aud(detail.surplus)}
            strong
            tone={
              closed
                ? "plain"
                : detail.surplus < 0
                  ? "bad"
                  : met
                    ? "in"
                    : "plain"
            }
          />
          <Figure
            label="Target"
            value={aud(detail.target)}
            tone={closed ? (met ? "in" : "bad") : "plain"}
          />
        </div>
      </div>

      {state === "closed" ? (
        <ReopenBar
          weekId={week.id}
          saved={detail.saved}
          target={detail.target}
        />
      ) : (
        <CloseBar detail={detail} today={today} />
      )}
    </div>
  );
}

/**
 * Closing the week, and what has to be true first.
 *
 * An invoiced client is only finished when the invoice exists and has been
 * paid, so those lines are listed by name and the button is disabled. It is not
 * a hard wall: ticking the override closes the week anyway, which is there for
 * the week that really does have to close with money still out.
 */
function CloseBar({ detail, today }: { detail: WeekDetail; today: string }) {
  const [state, action, pending] = useActionState(closeWeekAction, initial);
  const [open, setOpen] = useState(false);
  const [force, setForce] = useState(false);

  const stillToDo = detail.entries.filter((e) => e.status === "expected");
  const ended = detail.week.week_end < today;
  const blockers = detail.blockers;

  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-5 py-3 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {blockers.length > 0 ? (
            <>
              <span className="font-medium text-amber-600 dark:text-amber-400">
                {blockers.length}
              </span>{" "}
              {blockers.length === 1 ? "service" : "services"} still waiting on
              the bank: {blockerLine(blockers)}
            </>
          ) : (
            <>
              {stillToDo.length > 0 && (
                <>
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {stillToDo.length}
                  </span>{" "}
                  still to settle
                  {detail.outstanding > 0 && " · "}
                </>
              )}
              {detail.outstanding > 0 && (
                <>
                  <span className="font-medium text-amber-600 dark:text-amber-400">
                    {aud(detail.outstanding)}
                  </span>{" "}
                  still to arrive
                </>
              )}
              {stillToDo.length === 0 && detail.outstanding === 0 && (
                <>Everything is in. This week can be closed.</>
              )}
            </>
          )}
        </p>
        <button
          onClick={() => setOpen(true)}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          {ended ? "Close the week" : "Close early"}
        </button>
      </div>
    );
  }

  return (
    <form
      action={action}
      className="space-y-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800"
    >
      <input type="hidden" name="week_id" value={detail.week.id} />
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
        Close this week
      </h3>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {aud(detail.income)} in, {aud(detail.expenses_total)} out. Confirm what
        actually went to savings: the figure is what the plan counts, and you
        can see things this page cannot.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
            Saved this week (AUD)
          </span>
          <input
            name="saved"
            type="number"
            step="0.01"
            defaultValue={detail.saved.toFixed(2)}
            className="input"
            autoFocus
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
            Notes
          </span>
          <input
            name="notes"
            defaultValue={detail.week.notes ?? ""}
            className="input"
          />
        </label>
      </div>

      {blockers.length > 0 && (
        <div className="space-y-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900">
          <p className="font-semibold">
            This week is not finished on the billing side.
          </p>
          <ul className="space-y-0.5">
            {blockers.map((b) => (
              <li key={b.entry_id}>
                {b.client_name} · {aud(b.amount)} ·{" "}
                {b.reason === "not_invoiced"
                  ? "no invoice raised"
                  : b.reason === "not_received"
                    ? "transfer not received"
                    : `invoice ${
                        b.invoice_number ? `#${b.invoice_number}` : ""
                      } not paid`}
              </li>
            ))}
          </ul>
          <p>
            Invoice the work and record the payment, mark the transfer
            received, or mark the line paid in cash if that is how it was
            settled.
          </p>
          <label className="flex items-center gap-2 font-medium">
            <input
              type="checkbox"
              name="force"
              value="true"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Close it anyway, with that money still out
          </label>
        </div>
      )}

      {blockers.length === 0 && detail.outstanding > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900">
          {aud(detail.outstanding)} has not arrived yet. Closing now records the
          week as it stands; reopen it when the money lands if the figure
          changes.
        </p>
      )}

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900">
          {state.error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending || (blockers.length > 0 && !force)}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {pending ? "Closing…" : "Close the week"}
        </button>
      </div>
    </form>
  );
}

/** The blockers as one line, for the collapsed bar. */
function blockerLine(blockers: WeekDetail["blockers"]): string {
  const names = blockers.slice(0, 3).map((b) => b.client_name);
  const rest = blockers.length - names.length;
  return rest > 0 ? `${names.join(", ")} and ${rest} more` : names.join(", ");
}

function ReopenBar({
  weekId,
  saved,
  target,
}: {
  weekId: string;
  saved: number;
  target: number;
}) {
  const [state, action, pending] = useActionState(reopenWeekAction, initial);
  const met = saved >= target;

  return (
    <form
      action={action}
      className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl px-5 py-3 ring-1 ${
        met
          ? "bg-emerald-50 ring-emerald-200 dark:bg-emerald-950/30 dark:ring-emerald-900"
          : "bg-red-50 ring-red-200 dark:bg-red-950/30 dark:ring-red-900"
      }`}
    >
      <input type="hidden" name="week_id" value={weekId} />
      <p
        className={`text-sm ${
          met
            ? "text-emerald-900 dark:text-emerald-200"
            : "text-red-900 dark:text-red-200"
        }`}
      >
        <span className="font-semibold">Closed at {aud(saved)}</span>, against a
        target of {aud(target)}. Its figures are frozen: changing a rate or an
        expense now cannot rewrite it.
      </p>
      <div className="flex items-center gap-3">
        {state.error && (
          <span className="text-xs text-red-600 dark:text-red-400">
            {state.error}
          </span>
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {pending ? "…" : "Reopen"}
        </button>
      </div>
    </form>
  );
}

// -- one line ---------------------------------------------------------------

function EntryRow({
  entry,
  weekId,
  weekStart,
  closed,
  today,
}: {
  entry: WeekEntry;
  weekId: string;
  weekStart: string;
  closed: boolean;
  today: string;
}) {
  const [editing, setEditing] = useState(false);
  const [extraOpen, setExtraOpen] = useState(false);
  const billed = entry.invoice_id !== null;

  const tone =
    entry.status === "done"
      ? "border-l-emerald-400"
      : entry.status === "skipped"
        ? "border-l-slate-300 dark:border-l-slate-700"
        : "border-l-sky-300 dark:border-l-sky-800";

  if (editing) {
    return (
      <EntryForm
        entry={entry}
        weekId={weekId}
        today={today}
        onClose={() => setEditing(false)}
      />
    );
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-l-4 border-slate-100 px-4 py-3 last:border-b-0 dark:border-slate-800 ${tone}`}
    >
      <div className="min-w-[10rem] flex-1">
        <span
          className={`font-medium ${
            entry.status === "skipped"
              ? "text-slate-400 line-through dark:text-slate-600"
              : "text-slate-900 dark:text-slate-100"
          }`}
        >
          {entry.client_name}
        </span>
        {entry.status === "skipped" && (
          <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-400">
            Cancelled
          </span>
        )}
        {entry.source === "oneoff" && (
          <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-violet-800 dark:bg-violet-950/60 dark:text-violet-300">
            One-off
          </span>
        )}
        <InvoiceTag entry={entry} weekStart={weekStart} closed={closed} />
        {entry.extra_amount > 0 && (
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            + {aud(entry.extra_amount)} extra
            {entry.extra_note && ` · ${entry.extra_note}`}
          </div>
        )}
        {entry.note && (
          <div className="text-[11px] text-slate-400 dark:text-slate-500">
            {entry.note}
          </div>
        )}
      </div>

      {closed || billed ? (
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {weekdayLabel(entry.day)}
        </span>
      ) : (
        <MoveDay entry={entry} weekId={weekId} />
      )}

      <span className="text-xs text-slate-500 dark:text-slate-400">
        {methodLabel(entry.method)}
      </span>

      <span
        className={`text-xs ${
          entry.paid
            ? "text-emerald-600 dark:text-emerald-400"
            : entry.status === "done"
              ? "text-amber-600 dark:text-amber-400"
              : "text-slate-400 dark:text-slate-500"
        }`}
      >
        {entry.paid
          ? `Paid ${entry.paid_on ?? ""}`
          : entry.status === "done"
            ? "Not paid"
            : "–"}
      </span>

      <span className="w-24 text-right font-medium text-slate-900 dark:text-slate-100">
        {aud(entry.amount + entry.extra_amount)}
      </span>

      {!closed && (
        <div className="flex items-center gap-1">
          <StatusButtons entry={entry} weekId={weekId} />
          {!billed && (
            <button
              onClick={() => setExtraOpen((v) => !v)}
              className={`rounded-md px-2 py-1 text-xs font-medium ${
                entry.extra_amount > 0
                  ? "text-violet-700 hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-950/40"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              }`}
            >
              {entry.extra_amount > 0 ? "Extra" : "+ Extra"}
            </button>
          )}
          <button
            onClick={() => setEditing(true)}
            className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            Edit
          </button>
          {entry.source !== "rotation" && (
            <DeleteEntry id={entry.id} weekId={weekId} />
          )}
        </div>
      )}

      {extraOpen && !closed && !billed && (
        <ExtraForm
          entry={entry}
          weekId={weekId}
          onClose={() => setExtraOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * Extra work on this job, on this day, without opening anything else.
 *
 * The usual clean plus the oven is the most ordinary thing that happens in a
 * week, so it is two fields on the line itself rather than a trip through the
 * whole edit form. It adds to the line's own total, which is what the day and
 * the week then count.
 *
 * For a cash client this is where the extra lives. For a client billed on
 * account it is held here until the invoice is raised, and the invoice carries
 * it as a line of its own, which is why the button disappears once the line
 * follows an invoice.
 */
function ExtraForm({
  entry,
  weekId,
  onClose,
}: {
  entry: WeekEntry;
  weekId: string;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(
    saveEntryExtraAction,
    initial,
  );

  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  return (
    <form
      action={action}
      className="mt-1 w-full rounded-xl bg-slate-50 p-3 dark:bg-slate-950/40"
    >
      <input type="hidden" name="id" value={entry.id} />
      <input type="hidden" name="week_id" value={weekId} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
            Extra (AUD)
          </span>
          <input
            name="extra_amount"
            type="number"
            step="0.01"
            min="0"
            defaultValue={entry.extra_amount || ""}
            className="input w-28"
            autoFocus
          />
        </label>
        <label className="block min-w-[12rem] flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
            What it was
          </span>
          <input
            name="extra_note"
            defaultValue={entry.extra_note ?? ""}
            placeholder="Oven, windows, fridge…"
            className="input"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
      </div>
      <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
        {entry.extra_amount > 0
          ? `Replaces the ${aud(entry.extra_amount)} already on this line. Zero removes it.`
          : "Added on top of this client's usual rate for this day."}
      </p>
      {state.error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
    </form>
  );
}

/** How this line is settled, in the words used everywhere else. */
function methodLabel(method: WeekEntry["method"]): string {
  if (method === "cash") return "Cash";
  if (method === "transfer") return "Transfer";
  return "Account";
}

/**
 * Where this line stands with billing, which is the same question the invoice
 * page answers, asked from the week.
 *
 * Only a line billed on account has anything to say here: a cash job is settled
 * on the day and needs no document. Done on account with no invoice is the
 * state worth shouting about, because it is money nobody has asked for yet, and
 * it is the one thing that stops the week closing. The button beside it opens
 * the invoice form already filled in with this client, this amount and the day
 * the work actually happened, so the invoice comes back carrying the service
 * date the week matches on.
 */
function InvoiceTag({
  entry,
  weekStart,
  closed,
}: {
  entry: WeekEntry;
  weekStart: string;
  closed: boolean;
}) {
  // A transfer client is never invoiced, so there is no document to chase: what
  // that line waits for is the money, which the Paid column already says.
  if (entry.method === "transfer") {
    return entry.status === "done" && !entry.paid ? (
      <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-violet-800 dark:bg-violet-950/60 dark:text-violet-300">
        Waiting on transfer
      </span>
    ) : null;
  }
  if (entry.method !== "account") return null;

  if (entry.invoice_id) {
    const paid = entry.invoice_status === "paid";
    return (
      <Link
        href={`/invoices/${entry.invoice_id}`}
        className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide hover:underline ${
          paid
            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
            : "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300"
        }`}
      >
        {entry.invoice_number ? `Invoice #${entry.invoice_number}` : "Invoiced"}
        {paid ? " · paid" : " · unpaid"}
      </Link>
    );
  }

  if (entry.status !== "done") {
    return (
      <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-400">
        To invoice
      </span>
    );
  }

  const params = new URLSearchParams({
    client: entry.client_id ?? "",
    service_date: serviceDateFor(weekStart, entry.day),
    amount: String(entry.amount),
    ...(entry.extra_amount > 0 ? { extra: String(entry.extra_amount) } : {}),
    ...(entry.extra_note ? { extra_note: entry.extra_note } : {}),
  });

  return (
    <>
      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
        Not invoiced
      </span>
      {!closed && entry.client_id && (
        <Link
          href={`/invoices/new?${params.toString()}`}
          className="ml-2 text-[11px] font-medium text-sky-700 hover:underline dark:text-sky-400"
        >
          Invoice it
        </Link>
      )}
    </>
  );
}

/**
 * The day this job happened on, changed in place.
 *
 * The rotation says Tuesday and sometimes it is Thursday. That is a correction
 * to the week, not to the plan, and it is one of the two things that actually
 * change during a week, so it is a dropdown on the line rather than a form to
 * open. A line following an invoice shows its day as text instead: there the
 * invoice's service date is the record, and the two have to agree.
 */
function MoveDay({ entry, weekId }: { entry: WeekEntry; weekId: string }) {
  const [state, action, pending] = useActionState(setEntryDayAction, initial);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form action={action} ref={formRef} className="shrink-0">
      <input type="hidden" name="id" value={entry.id} />
      <input type="hidden" name="week_id" value={weekId} />
      <select
        name="day"
        defaultValue={String(entry.day ?? "")}
        disabled={pending}
        onChange={() => formRef.current?.requestSubmit()}
        title={state.error ?? "The day it actually happened"}
        className={`rounded-md border-0 bg-transparent px-1 py-0.5 text-xs ${
          state.error
            ? "text-red-600 dark:text-red-400"
            : "text-slate-500 dark:text-slate-400"
        } hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800`}
      >
        <option value="">No day</option>
        {WEEKDAYS.map((d) => (
          <option key={d.value} value={d.value}>
            {d.short}
          </option>
        ))}
      </select>
    </form>
  );
}

/**
 * What happened to this job, in one click.
 *
 * The ordinary case needs no click at all: the work is regular, so a job whose
 * day has gone by is recorded as done by itself. These buttons are for the
 * exception, and each one is a single press rather than a cycle through states:
 * saying a client cancelled used to mean pressing Done and then undoing it.
 *
 *   planned    → Done (count it early) or Cancelled
 *   done       → Cancelled
 *   cancelled  → Undo, back to planned
 */
function StatusButtons({
  entry,
  weekId,
}: {
  entry: WeekEntry;
  weekId: string;
}) {
  if (entry.status === "skipped") {
    return (
      <StatusButton
        entry={entry}
        weekId={weekId}
        status="expected"
        label="Undo"
      />
    );
  }

  return (
    <>
      {entry.status !== "done" && (
        <StatusButton
          entry={entry}
          weekId={weekId}
          status="done"
          label="Done"
          strong
        />
      )}
      <StatusButton
        entry={entry}
        weekId={weekId}
        status="skipped"
        label="Cancelled"
      />
    </>
  );
}

function StatusButton({
  entry,
  weekId,
  status,
  label,
  strong = false,
}: {
  entry: WeekEntry;
  weekId: string;
  status: "expected" | "done" | "skipped";
  label: string;
  strong?: boolean;
}) {
  const [, action, pending] = useActionState(setEntryStatusAction, initial);

  return (
    <form action={action}>
      <input type="hidden" name="id" value={entry.id} />
      <input type="hidden" name="week_id" value={weekId} />
      <input type="hidden" name="status" value={status} />
      <input type="hidden" name="method" value={entry.method} />
      <button
        type="submit"
        disabled={pending}
        className={`rounded-md px-2 py-1 text-xs font-medium disabled:opacity-60 ${
          strong
            ? "bg-emerald-600 text-white hover:bg-emerald-700"
            : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        }`}
      >
        {pending ? "…" : label}
      </button>
    </form>
  );
}

function DeleteEntry({ id, weekId }: { id: string; weekId: string }) {
  const [, action, pending] = useActionState(deleteEntryAction, initial);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="week_id" value={weekId} />
      <button
        type="submit"
        disabled={pending}
        title="Remove this line"
        className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60 dark:text-red-400 dark:hover:bg-red-950/50"
      >
        {pending ? "…" : "Remove"}
      </button>
    </form>
  );
}

function EntryForm({
  entry,
  weekId,
  today,
  onClose,
}: {
  entry: WeekEntry;
  weekId: string;
  today: string;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(saveEntryAction, initial);
  const [paid, setPaid] = useState(entry.paid);
  const billed = entry.invoice_id !== null;

  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  return (
    <form
      action={action}
      className="space-y-3 border-b border-slate-100 bg-slate-50 px-4 py-4 last:border-b-0 dark:border-slate-800 dark:bg-slate-950/40"
    >
      <input type="hidden" name="id" value={entry.id} />
      <input type="hidden" name="week_id" value={weekId} />

      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
        {entry.client_name}
      </p>

      {billed && (
        <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900 ring-1 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:ring-sky-900">
          This line follows invoice{" "}
          {entry.invoice_number ? `#${entry.invoice_number}` : "it is linked to"}
          . Its amount, the day it happened and whether it is paid all come from
          that invoice, so change them there and this follows. The extra sits on
          the invoice as a line of its own, which is why it reads zero here.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
            Status
          </span>
          <select name="status" defaultValue={entry.status} className="input">
            <option value="expected">Planned</option>
            <option value="done">Done</option>
            <option value="skipped">Cancelled</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
            Day it happened
          </span>
          <select
            name="day"
            defaultValue={String(entry.day ?? "")}
            className="input"
          >
            <option value="">No day</option>
            {WEEKDAYS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
            Amount (AUD)
          </span>
          <input
            name="amount"
            type="number"
            step="0.01"
            min="0"
            defaultValue={entry.amount}
            readOnly={billed}
            className="input"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
            Paid how
          </span>
          <select name="method" defaultValue={entry.method} className="input">
            <option value="cash">Cash, in hand</option>
            <option value="transfer">Transfer, no invoice</option>
            <option value="account">Invoiced</option>
          </select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
            Extra work (AUD)
          </span>
          <input
            name="extra_amount"
            type="number"
            step="0.01"
            min="0"
            defaultValue={entry.extra_amount}
            className="input"
          />
        </label>
        <label className="block sm:col-span-3">
          <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
            What the extra was
          </span>
          <input
            name="extra_note"
            defaultValue={entry.extra_note ?? ""}
            className="input"
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <label className="flex items-center gap-2 pt-5 text-sm text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            name="paid"
            value="true"
            checked={paid}
            onChange={(e) => setPaid(e.target.checked)}
            disabled={billed}
            className="h-4 w-4 rounded border-slate-300 dark:border-slate-700"
          />
          Paid
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
            Paid on
          </span>
          <input
            name="paid_on"
            type="date"
            defaultValue={entry.paid_on ?? today}
            disabled={!paid || billed}
            className="input"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
            Note
          </span>
          <input
            name="note"
            defaultValue={entry.note ?? ""}
            className="input"
          />
        </label>
      </div>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900">
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
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

// -- adding work ------------------------------------------------------------

/**
 * Work the rotation did not expect, which is three different things.
 *
 * A client of the other week, done in this one. A client who is not on the
 * rotation at all. And a job for somebody who is not a client and never will
 * be. The first two are the same thing to the system: a line with a client
 * behind it, named after them, which is why picking from the list is one tab
 * and a one-off is the other.
 *
 * Extra work for a client who IS on this week is none of these: that belongs on
 * their own line, as its extra, so it stays one service with one amount.
 *
 * Anything added here counts in the week immediately: it is recorded because it
 * happened, so it goes in done, and cash goes in paid.
 */
function AddEntry({
  weekId,
  clients,
}: {
  weekId: string;
  clients: ClientWithIssuer[];
}) {
  const [open, setOpen] = useState(false);
  const [oneOff, setOneOff] = useState(false);
  const [state, action, pending] = useActionState(addEntryAction, initial);
  // Picking a client fills in what the system already knows about them: their
  // rate, and how they pay. Both stay editable, because this week may be why
  // the line is being added at all.
  const [clientId, setClientId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");

  function onPick(id: string) {
    setClientId(id);
    const c = clients.find((x) => x.id === id);
    if (!c) return;
    setAmount(c.default_rate != null ? String(c.default_rate) : "");
    setMethod(methodFor(c.billing_type));
  }

  // The dialog stays open after a save so several jobs can go in one after
  // another, which is how a week is actually caught up on.

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
      >
        + Add work
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <form
        action={action}
        className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900"
      >
        <input type="hidden" name="week_id" value={weekId} />
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Add work to this week
        </h3>

        <div className="flex gap-2 text-xs">
          <button
            type="button"
            onClick={() => setOneOff(false)}
            className={`rounded-lg px-3 py-1.5 font-medium ${
              !oneOff
                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            }`}
          >
            A client
          </button>
          <button
            type="button"
            onClick={() => setOneOff(true)}
            className={`rounded-lg px-3 py-1.5 font-medium ${
              oneOff
                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            }`}
          >
            A one-off job
          </button>
        </div>

        {oneOff ? (
          <>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              A job done once for somebody who is not a client. It belongs to
              this week and creates nobody in the client list.
            </p>
            <Labelled label="What it was" required>
              <input name="client_name" required className="input" autoFocus />
            </Labelled>
          </>
        ) : (
          <Labelled label="Client" required>
            <select
              name="client_id"
              required
              value={clientId}
              onChange={(e) => onPick(e.target.value)}
              className="input"
            >
              <option value="">Pick one</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Labelled>
        )}

        {/* Three across is fine on a laptop and unusable on a phone. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Labelled label="Amount (AUD)" required>
            <input
              name="amount"
              type="number"
              step="0.01"
              min="0"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="input"
            />
          </Labelled>
          <Labelled label="Day">
            <select name="day" className="input">
              <option value="">No day</option>
              {WEEKDAYS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </Labelled>
          <Labelled label="Paid how">
            <select
              name="method"
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              className="input"
            >
              <option value="cash">Cash, in hand</option>
              <option value="transfer">Transfer, no invoice</option>
              <option value="account">Invoiced</option>
            </select>
          </Labelled>
        </div>

        <Labelled label="Note">
          <input name="note" className="input" />
        </Labelled>

        {state.error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900">
            {state.error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Close
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
          >
            {pending ? "Adding…" : "Add"}
          </button>
        </div>
      </form>
    </div>
  );
}

// -- expenses ---------------------------------------------------------------

/**
 * What the week cost, without the standing list in the way.
 *
 * The fixed costs are the same every week and are maintained on their own page,
 * so repeating all seventeen of them on every week made the panel a wall of
 * numbers that never change. What belongs to THIS week is the total, and the
 * costs that happened only here. The fixed list is one click away for the week
 * where one of them really was different.
 */
function Expenses({
  weekId,
  weekEnd,
  closed,
  standing,
  recorded,
  total,
  detail,
}: {
  weekId: string;
  /** The week's last day, which decides which standing costs it pays. */
  weekEnd: string;
  closed: boolean;
  standing: ExpenseItem[];
  recorded: WeekDetail["expenses"];
  total: number;
  detail: WeekDetail;
}) {
  const [adding, setAdding] = useState(false);
  const [showFixed, setShowFixed] = useState(false);

  const overrides = new Map(
    recorded
      .filter((x) => x.kind === "override" && x.expense_item_id)
      .map((x) => [x.expense_item_id as string, x]),
  );
  const oneOffs = recorded.filter((x) => x.kind === "oneoff");
  const snapshots = recorded.filter((x) => x.kind === "snapshot");

  // A closed week reads the rows it froze; an open one reads the standing list
  // as it is today, with this week's changes on top.
  const fixed = closed
    ? [...snapshots, ...overrides.values()].map((x) => ({
        key: x.id,
        name: x.name,
        amount: x.amount,
        changed: x.kind === "override",
        recordedId: null as string | null,
        itemId: x.expense_item_id,
        standing: null as number | null,
      }))
    : standing
        // A cost that starts later belongs to later weeks. Without this, adding
        // one today would show up in every open week behind it.
        .filter((i) => appliesToWeek(i, weekEnd))
        .map((i) => {
          const o = overrides.get(i.id);
          return {
            key: i.id,
            name: i.name,
            amount: o?.amount ?? i.weekly_amount,
            changed: Boolean(o),
            recordedId: o?.id ?? null,
            itemId: i.id as string | null,
            standing: i.weekly_amount as number | null,
          };
        });

  const fixedTotal = fixed.reduce((sum, r) => sum + r.amount, 0);
  const extrasTotal = oneOffs.reduce((sum, x) => sum + x.amount, 0);
  const changed = fixed.filter((r) => r.changed).length;

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
          What it cost
        </h2>
        <span className="text-lg font-bold text-rose-400 dark:text-rose-400/90">
          {aud(total)}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        {closed
          ? "Frozen as it stood when the week closed."
          : "The weekly costs, plus anything that only happened this week."}
      </p>

      <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
        <span className="text-sm text-slate-700 dark:text-slate-300">
          Weekly costs
          {changed > 0 && (
            <span className="ml-2 text-[11px] text-amber-600 dark:text-amber-400">
              {changed} different this week
            </span>
          )}
        </span>
        <span className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
            {aud(fixedTotal)}
          </span>
          <button
            onClick={() => setShowFixed((v) => !v)}
            className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            {showFixed ? "Hide" : "Show"}
          </button>
        </span>
      </div>

      {showFixed && (
        <ul className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800">
          {fixed.map((r) => (
            <li
              key={r.key}
              className="flex items-center justify-between gap-3 py-2"
            >
              <span className="text-sm text-slate-600 dark:text-slate-400">
                {r.name}
                {r.changed && r.standing !== null && (
                  <span className="ml-2 text-[11px] text-amber-600 dark:text-amber-400">
                    normally {aud(r.standing)}
                  </span>
                )}
              </span>
              <span className="flex items-center gap-2">
                <span className="text-sm text-slate-700 dark:text-slate-300">
                  {aud(r.amount)}
                </span>
                {!closed && (
                  <ExpenseEditor
                    weekId={weekId}
                    itemId={r.itemId}
                    name={r.name}
                    amount={r.amount}
                    recordedId={r.recordedId}
                    oneOff={false}
                  />
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 border-t border-slate-100 pt-3 dark:border-slate-800">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm text-slate-700 dark:text-slate-300">
            Only this week
          </span>
          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
            {aud(extrasTotal)}
          </span>
        </div>

        {oneOffs.length > 0 && (
          <ul className="mt-1 divide-y divide-slate-100 dark:divide-slate-800">
            {oneOffs.map((x) => (
              <li
                key={x.id}
                className="flex items-center justify-between gap-3 py-2"
              >
                <span className="text-sm text-slate-600 dark:text-slate-400">
                  {x.name}
                  {x.note && (
                    <span className="ml-2 text-[11px] text-slate-400 dark:text-slate-500">
                      {x.note}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-sm text-slate-700 dark:text-slate-300">
                    {aud(x.amount)}
                  </span>
                  {!closed && (
                    <ExpenseEditor
                      weekId={weekId}
                      itemId={null}
                      name={x.name}
                      amount={x.amount}
                      recordedId={x.id}
                      oneOff
                    />
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!closed &&
        (adding ? (
          <OneOffExpense weekId={weekId} onClose={() => setAdding(false)} />
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="mt-3 w-full rounded-lg border border-dashed border-slate-300 py-2 text-xs font-medium text-slate-400 transition hover:border-slate-400 hover:text-slate-600 dark:border-slate-700 dark:text-slate-500 dark:hover:border-slate-600 dark:hover:text-slate-300"
          >
            + Something unexpected
          </button>
        ))}

      <CoveredBy detail={detail} />
    </section>
  );
}


/**
 * Who pays the week: the cash first, the invoicing for whatever is left.
 *
 * The bills are meant to come out of the money that is already in hand, which
 * is the cash and the transfers, both settled the week the work is done. Only
 * what that does not reach has to wait on an invoice being raised and paid, and
 * that is the number worth seeing: it says whether the week stands on its own
 * or is leaning on the billing. Whatever survives the costs is the saving.
 */
function CoveredBy({ detail }: { detail: WeekDetail }) {
  const short = detail.short_from_invoicing > 0;
  const closed = detail.state === "closed";

  return (
    <div className="mt-4 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200 dark:bg-slate-950/40 dark:ring-slate-800">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        How it is covered
      </h3>
      <dl className="mt-3 space-y-1.5">
        <CoverRow label="Cash in" value={aud(detail.cash_in)} />
        <CoverRow
          label="The week's costs"
          value={`- ${aud(detail.expenses_total)}`}
        />

        <div className="border-t border-slate-200 pt-1.5 dark:border-slate-800">
          {short ? (
            <CoverRow
              label="Short, from invoicing"
              value={aud(detail.short_from_invoicing)}
              tone="warn"
            />
          ) : (
            <CoverRow
              label="Cash left over"
              value={aud(detail.cash_left)}
              tone="good"
            />
          )}
          <CoverRow label="Invoiced this week" value={aud(detail.invoiced_in)} />
        </div>

        <div className="border-t border-slate-200 pt-1.5 dark:border-slate-800">
          <CoverRow
            label="Left to save"
            value={aud(detail.surplus)}
            tone={detail.surplus < 0 ? "bad" : "good"}
            strong={!closed}
          />
          {/* A closed week has two figures, and the second one is the truth:
              what was confirmed into the vault at close. They differ whenever
              he could see something this page could not, and showing both is
              how that difference stays visible instead of being argued with. */}
          {closed && (
            <CoverRow
              label="Saved in vault"
              value={aud(detail.saved)}
              tone={detail.saved < 0 ? "bad" : "good"}
              strong
            />
          )}
        </div>
      </dl>
    </div>
  );
}

function CoverRow({
  label,
  hint,
  value,
  tone = "plain",
  strong = false,
}: {
  label: string;
  hint?: string;
  value: string;
  tone?: "plain" | "good" | "warn" | "bad";
  strong?: boolean;
}) {
  const colour =
    tone === "good"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "bad"
          ? "text-rose-600 dark:text-rose-400"
          : "text-slate-900 dark:text-slate-100";

  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-sm text-slate-700 dark:text-slate-300">
        {label}
        {hint && (
          <span className="ml-2 text-[11px] text-slate-400 dark:text-slate-500">
            {hint}
          </span>
        )}
      </dt>
      <dd
        className={`text-sm ${strong ? "font-bold" : "font-medium"} ${colour}`}
      >
        {value}
      </dd>
    </div>
  );
}

function ExpenseEditor({
  weekId,
  itemId,
  name,
  amount,
  recordedId,
  oneOff,
}: {
  weekId: string;
  itemId: string | null;
  name: string;
  amount: number;
  recordedId: string | null;
  oneOff: boolean;
}) {
  const [asked, setAsked] = useState(false);
  const [state, action, pending] = useActionState(
    saveWeekExpenseAction,
    initial,
  );
  const [, removeAction, removing] = useActionState(
    deleteWeekExpenseAction,
    initial,
  );

  // Derived rather than an effect: the editor is open because it was asked for
  // and the save has not landed. Mirroring that into state just to set it back
  // costs a second render and a rule about cascading effects.
  const open = asked && !state.ok;
  const setOpen = setAsked;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
      >
        Change
      </button>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <form action={action} className="flex items-center gap-1">
        <input type="hidden" name="week_id" value={weekId} />
        {itemId && (
          <input type="hidden" name="expense_item_id" value={itemId} />
        )}
        <input type="hidden" name="name" value={name} />
        <input
          name="amount"
          type="number"
          step="0.01"
          min="0"
          defaultValue={amount}
          autoFocus
          className="w-24 rounded border border-slate-300 px-1.5 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-900"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900"
        >
          {pending ? "…" : "Save"}
        </button>
      </form>
      {recordedId && (
        <form action={removeAction}>
          <input type="hidden" name="id" value={recordedId} />
          <input type="hidden" name="week_id" value={weekId} />
          <button
            type="submit"
            disabled={removing}
            title={oneOff ? "Remove this one-off" : "Back to the usual amount"}
            className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-60 dark:text-red-400 dark:hover:bg-red-950/50"
          >
            {removing ? "…" : oneOff ? "Remove" : "Reset"}
          </button>
        </form>
      )}
      <button
        onClick={() => setOpen(false)}
        className="rounded-md px-1.5 py-0.5 text-[11px] text-slate-400 dark:text-slate-500"
      >
        Cancel
      </button>
    </span>
  );
}

function OneOffExpense({
  weekId,
  onClose,
}: {
  weekId: string;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(
    saveWeekExpenseAction,
    initial,
  );
  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  return (
    <form action={action} className="mt-3 space-y-2">
      <input type="hidden" name="week_id" value={weekId} />
      <div className="grid grid-cols-3 gap-2">
        <input
          name="name"
          required
          autoFocus
          placeholder="What happened"
          className="input col-span-2"
        />
        <input
          name="amount"
          type="number"
          step="0.01"
          min="0"
          required
          placeholder="AUD"
          className="input"
        />
      </div>
      {state.error && (
        <p className="text-xs text-red-600 dark:text-red-400">{state.error}</p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900"
        >
          {pending ? "…" : "Add"}
        </button>
      </div>
    </form>
  );
}

/**
 * What happened this week, in words, kept as words.
 *
 * A saved note is shown as the note it is, not left sitting in the box it was
 * typed into: a text area that always looks the same whether or not anything
 * was stored reads as a draft nobody kept, and the only way to find out was to
 * reload the page. The box comes back on Edit.
 */
function Notes({ weekId, notes }: { weekId: string; notes: string | null }) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Notes
          </h2>
          {notes && (
            <button
              onClick={() => setEditing(true)}
              className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              Edit
            </button>
          )}
        </div>

        {notes ? (
          <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">
            {notes}
          </p>
        ) : (
          <>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Anything unusual about this week. Never printed anywhere.
            </p>
            <button
              onClick={() => setEditing(true)}
              className="mt-3 w-full rounded-lg border border-dashed border-slate-300 py-2 text-xs font-medium text-slate-400 transition hover:border-slate-400 hover:text-slate-600 dark:border-slate-700 dark:text-slate-500 dark:hover:border-slate-600 dark:hover:text-slate-300"
            >
              + Add a note
            </button>
          </>
        )}
      </section>
    );
  }

  return (
    <NotesForm
      weekId={weekId}
      notes={notes}
      onDone={() => setEditing(false)}
    />
  );
}

function NotesForm({
  weekId,
  notes,
  onDone,
}: {
  weekId: string;
  notes: string | null;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(saveWeekNotesAction, initial);

  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  return (
    <form
      action={action}
      className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800"
    >
      <input type="hidden" name="week_id" value={weekId} />
      <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
        Notes
      </h2>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Anything unusual about this week. Never printed anywhere.
      </p>
      <textarea
        name="notes"
        rows={4}
        defaultValue={notes ?? ""}
        autoFocus
        className="input mt-3"
      />
      {state.error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900"
        >
          {pending ? "…" : "Save"}
        </button>
      </div>
    </form>
  );
}

// -- small pieces -----------------------------------------------------------

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

const TONES = {
  plain: "text-slate-900 dark:text-slate-100",
  out: "text-rose-400 dark:text-rose-400/90",
  in: "text-emerald-600 dark:text-emerald-400",
  bad: "text-red-600 dark:text-red-400",
  wait: "text-amber-600 dark:text-amber-400",
} as const;

function Figure({
  label,
  value,
  strong = false,
  tone = "plain",
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: keyof typeof TONES;
}) {
  return (
    <div className="text-right">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p
        className={`font-bold ${strong ? "text-xl" : "text-base"} ${TONES[tone]}`}
      >
        {value}
      </p>
    </div>
  );
}
