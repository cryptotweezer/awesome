"use client";

import { useActionState, useEffect, useState } from "react";
import { aud, shortDate } from "@/lib/savings";
import {
  deletePlanAction,
  extendPlanAction,
  savePlanAction,
  startPlanAction,
  type ActionState,
} from "./actions";

const initial: ActionState = { ok: false };

/** What a plan came to, worked out on the server from its own weeks. */
export type PlanResult = {
  id: string;
  name: string | null;
  starts_on: string;
  ends_on: string;
  weekly_target: number;
  horizon_months: number;
  total_weeks: number;
  weeks_opened: number;
  weeks_closed: number;
  saved: number;
  target_total: number;
  percent: number;
  met: boolean;
  finished: boolean;
  notes: string | null;
};

/**
 * The plan as it stands, the form when it is wanted, and everything before it.
 *
 * A plan ends, and that is the point of having more than one: a two-year figure
 * is impossible to feel and three six-month plans are not. So the page has to be
 * able to say "that one is done, here is how it went" and start the next, which
 * is three states rather than one screen: a plan running, no plan running, and
 * the ones already finished.
 */
export function PlanPanel({
  current,
  history,
  today,
}: {
  /** The plan running today, with its progress. Null between plans. */
  current: PlanResult | null;
  /** Every plan whose last week has gone by, newest first. */
  history: PlanResult[];
  today: string;
}) {
  const [editing, setEditing] = useState(false);
  const [starting, setStarting] = useState(false);

  return (
    <div className="space-y-6">
      {current === null ? (
        <StartPlan
          today={today}
          after={history[0] ?? null}
          open={starting || history.length === 0}
          onOpen={() => setStarting(true)}
          onDone={() => setStarting(false)}
        />
      ) : editing ? (
        <PlanForm
          plan={current}
          onDone={() => setEditing(false)}
          submitLabel="Save"
        />
      ) : (
        <CurrentPlan
          plan={current}
          today={today}
          onEdit={() => setEditing(true)}
        />
      )}

      {history.length > 0 && <History rows={history} />}
    </div>
  );
}

// -- the plan running now ---------------------------------------------------

function CurrentPlan({
  plan,
  today,
  onEdit,
}: {
  plan: PlanResult;
  today: string;
  onEdit: () => void;
}) {
  const started = plan.starts_on <= today;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                plan.finished
                  ? plan.met
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                    : "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                  : started
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                    : "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300"
              }`}
            >
              {plan.finished ? "Finished" : started ? "Running" : "Starts soon"}
            </span>
            {plan.name && (
              <p className="mt-2 text-sm font-semibold text-slate-500 dark:text-slate-400">
                {plan.name}
              </p>
            )}
            <p className="mt-1 text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              {aud(plan.weekly_target)}
              <span className="ml-1 text-sm font-medium text-slate-500 dark:text-slate-400">
                a week
              </span>
            </p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {plan.horizon_months} months, {plan.total_weeks} weeks, coming to{" "}
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {aud(plan.target_total)}
              </span>
            </p>
          </div>
          <button
            onClick={onEdit}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Edit
          </button>
        </div>

        <dl className="mt-5 grid gap-4 border-t border-slate-100 pt-4 text-sm dark:border-slate-800 sm:grid-cols-4">
          <Field label="Week 1 starts" value={shortDate(plan.starts_on)} />
          <Field label="Last week ends" value={shortDate(plan.ends_on)} />
          <Field
            label="Weeks"
            value={`${plan.weeks_closed} closed of ${plan.weeks_opened} open, ${plan.total_weeks} planned`}
          />
          <Field label="Notes" value={plan.notes || "–"} />
        </dl>
      </div>

      {plan.finished && <Finished plan={plan} />}

      <DeletePlan
        id={plan.id}
        weeks={plan.weeks_opened}
        closed={plan.weeks_closed}
      />
    </div>
  );
}

/**
 * A plan whose last week has gone by, still in the current slot.
 *
 * It is not filed away by itself: its weeks may still be open with money on the
 * way, and a plan that vanished the day its horizon passed would take those with
 * it. There are two honest ways on, and this says both.
 */
function Finished({ plan }: { plan: PlanResult }) {
  const [state, action, pending] = useActionState(extendPlanAction, initial);

  return (
    <div
      className={`space-y-3 rounded-2xl p-5 ring-1 ${
        plan.met
          ? "bg-emerald-50 ring-emerald-200 dark:bg-emerald-950/30 dark:ring-emerald-900"
          : "bg-amber-50 ring-amber-200 dark:bg-amber-950/30 dark:ring-amber-900"
      }`}
    >
      <h3
        className={`text-sm font-semibold ${
          plan.met
            ? "text-emerald-900 dark:text-emerald-200"
            : "text-amber-900 dark:text-amber-200"
        }`}
      >
        {plan.met
          ? `This plan is done, and you made it: ${aud(plan.saved)} of ${aud(
              plan.target_total,
            )}.`
          : `This plan reached its last week at ${aud(plan.saved)} of ${aud(
              plan.target_total,
            )}, ${plan.percent}%.`}
      </h3>
      <p
        className={`text-xs ${
          plan.met
            ? "text-emerald-900/80 dark:text-emerald-200/80"
            : "text-amber-900/80 dark:text-amber-200/80"
        }`}
      >
        Start the next plan and this one moves to the history with that result.
        Or keep it running longer, if the money is still coming in.
      </p>
      <form action={action} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="id" value={plan.id} />
        <label className="block">
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Keep going, months
          </span>
          <input
            name="months"
            type="number"
            min="1"
            max="120"
            defaultValue="3"
            className="input w-24"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {pending ? "…" : "Extend"}
        </button>
        {state.error && (
          <span className="text-xs text-red-600 dark:text-red-400">
            {state.error}
          </span>
        )}
      </form>
    </div>
  );
}

// -- starting the next one --------------------------------------------------

function StartPlan({
  today,
  after,
  open,
  onOpen,
  onDone,
}: {
  today: string;
  /** The plan before this one, so the new one cannot start inside it. */
  after: PlanResult | null;
  open: boolean;
  onOpen: () => void;
  onDone: () => void;
}) {
  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-5 py-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          No plan is running, so no new weeks are being opened.
        </p>
        <button
          onClick={onOpen}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          Start a plan
        </button>
      </div>
    );
  }

  return (
    <PlanForm
      plan={null}
      today={today}
      earliest={after ? after.ends_on : null}
      onDone={onDone}
      submitLabel="Start the plan"
    />
  );
}

// -- the form ---------------------------------------------------------------

/**
 * The two numbers the plan runs on, the day it begins, and a name for it.
 *
 * The total is shown as it is typed rather than stored, so there is one number
 * to edit and never two that disagree. The start date is required now: with
 * plans one after another, "no date yet" is not a plan waiting to begin, it is
 * no plan, and the page says that without needing a row for it.
 */
export function PlanForm({
  plan,
  today,
  earliest = null,
  onDone,
  submitLabel,
}: {
  plan: PlanResult | null;
  today?: string;
  /** The last day of the previous plan: a new one has to start after it. */
  earliest?: string | null;
  onDone: () => void;
  submitLabel: string;
}) {
  const [state, action, pending] = useActionState(
    plan ? savePlanAction : startPlanAction,
    initial,
  );
  const [target, setTarget] = useState(
    plan ? String(plan.weekly_target) : "1000",
  );
  const [months, setMonths] = useState(plan ? String(plan.horizon_months) : "6");

  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  const weeks = Math.round((Number(months) / 12) * 52);
  const total = Number(target) * weeks;
  const sane = Number.isFinite(total) && weeks > 0;

  // The day after the last plan ended, which is where a new one belongs.
  const earliestStart = earliest
    ? new Date(new Date(`${earliest}T00:00:00Z`).getTime() + 86_400_000)
        .toISOString()
        .slice(0, 10)
    : undefined;

  return (
    <form
      action={action}
      className="space-y-5 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800"
    >
      {plan && <input type="hidden" name="id" value={plan.id} />}

      <div className="grid gap-4 sm:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
            Name it (optional)
          </span>
          <input
            name="name"
            defaultValue={plan?.name ?? ""}
            placeholder="Visa, car, first year…"
            className="input"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
            Save per week (AUD) <span className="text-red-500">*</span>
          </span>
          <input
            name="weekly_target"
            type="number"
            step="0.01"
            min="0"
            required
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="input"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
            For how long (months) <span className="text-red-500">*</span>
          </span>
          <input
            name="horizon_months"
            type="number"
            min="1"
            max="600"
            required
            value={months}
            onChange={(e) => setMonths(e.target.value)}
            className="input"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
            Week 1 starts on <span className="text-red-500">*</span>
          </span>
          <input
            name="starts_on"
            type="date"
            required
            min={earliestStart}
            defaultValue={plan?.starts_on ?? earliestStart ?? today ?? ""}
            className="input"
          />
          {earliest && (
            <span className="mt-1 block text-[11px] text-slate-400 dark:text-slate-500">
              The last plan ended {shortDate(earliest)}
            </span>
          )}
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
          Notes
        </span>
        <input name="notes" defaultValue={plan?.notes ?? ""} className="input" />
      </label>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {sane ? (
            <>
              {weeks} weeks at {aud(Number(target))} comes to{" "}
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {aud(total)}
              </span>
              .
            </>
          ) : (
            "Fill both numbers to see what the plan adds up to."
          )}
        </p>
        <div className="flex items-center gap-3">
          {state.error && (
            <span className="text-sm text-red-600 dark:text-red-400">
              {state.error}
            </span>
          )}
          <button
            type="button"
            onClick={onDone}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
          >
            {pending ? "Saving…" : submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}

// -- what came before -------------------------------------------------------

/**
 * Every plan that has ended, and whether it was made.
 *
 * This is the reason plans have an identity at all. Each row's figures come
 * from that plan's own weeks, every one of which froze what it saved as it
 * closed, so a finished plan's result cannot move afterwards.
 */
function History({ rows }: { rows: PlanResult[] }) {
  const made = rows.filter((r) => r.met).length;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Plans before this
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {made} of {rows.length} met
        </p>
      </div>

      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3 font-medium">Plan</th>
              <th className="px-4 py-3 font-medium">Weeks</th>
              <th className="px-4 py-3 text-right font-medium">A week</th>
              <th className="px-4 py-3 text-right font-medium">Target</th>
              <th className="px-4 py-3 text-right font-medium">Saved</th>
              <th className="px-4 py-3 text-right font-medium">Of target</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3">
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {r.name || `${r.horizon_months} months`}
                  </span>
                  <div className="text-[11px] text-slate-400 dark:text-slate-500">
                    {shortDate(r.starts_on)} to {shortDate(r.ends_on)}
                    {r.notes && ` · ${r.notes}`}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                  {r.weeks_closed} of {r.total_weeks} closed
                </td>
                <td className="px-4 py-3 text-right text-slate-500 dark:text-slate-400">
                  {aud(r.weekly_target)}
                </td>
                <td className="px-4 py-3 text-right text-slate-500 dark:text-slate-400">
                  {aud(r.target_total)}
                </td>
                <td className="px-4 py-3 text-right font-semibold text-slate-900 dark:text-slate-100">
                  {aud(r.saved)}
                </td>
                <td className="px-4 py-3 text-right">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      r.met
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                        : r.percent >= 80
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                          : "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300"
                    }`}
                  >
                    {r.percent}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// -- small pieces -----------------------------------------------------------

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </dt>
      <dd className="mt-0.5 font-medium text-slate-900 dark:text-slate-100">
        {value}
      </dd>
    </div>
  );
}

/**
 * Deleting a plan, said out loud before it happens.
 *
 * The weeks go with it, and how many is printed rather than implied: the number
 * is the only thing that tells somebody whether this is a test being cleared or
 * a year of history. Invoices are not part of a plan and do not move.
 */
function DeletePlan({
  id,
  weeks,
  closed,
}: {
  id: string;
  weeks: number;
  closed: number;
}) {
  const [state, action, pending] = useActionState(deletePlanAction, initial);
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
      >
        Delete this plan
      </button>
    );
  }

  return (
    <form
      action={action}
      className="space-y-3 rounded-2xl bg-red-50 p-5 ring-1 ring-red-200 dark:bg-red-950/30 dark:ring-red-900"
    >
      <input type="hidden" name="id" value={id} />
      <h3 className="text-sm font-semibold text-red-900 dark:text-red-200">
        Delete the plan and start again
      </h3>
      <p className="text-xs text-red-900/80 dark:text-red-200/80">
        This deletes the plan and{" "}
        <span className="font-semibold">
          {weeks} {weeks === 1 ? "week" : "weeks"}
        </span>
        {closed > 0 && (
          <>
            {" "}
            (<span className="font-semibold">{closed} closed</span>)
          </>
        )}
        , with everything recorded on them: the work, the payments and the costs
        of each week. It cannot be undone.
      </p>
      <p className="text-xs text-red-900/80 dark:text-red-200/80">
        Your clients and their rotation, the fixed expenses, the loans and every
        invoice stay exactly as they are.
      </p>
      <label className="flex items-center gap-2 text-xs font-medium text-red-900 dark:text-red-200">
        <input
          type="checkbox"
          name="confirm"
          value="true"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="h-3.5 w-3.5"
        />
        I understand those weeks go too
      </label>
      {state.error && (
        <p className="text-xs font-medium text-red-700 dark:text-red-300">
          {state.error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-100 dark:border-red-900 dark:text-red-200 dark:hover:bg-red-950/60"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending || !confirmed}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
        >
          {pending ? "Deleting…" : "Delete the plan"}
        </button>
      </div>
    </form>
  );
}
