"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { aud, shortDate } from "@/lib/savings";
import type { Milestone } from "@/lib/data/savings-progress";
import { MilestoneCards } from "./milestones";
import {
  archivePlanAction,
  deletePlanAction,
  extendPlanAction,
  savePlanAction,
  startPlanAction,
  type ActionState,
} from "./actions";

const initial: ActionState = { ok: false };

/** One week of a plan, enough to list it and open it. */
export type PlanWeek = {
  id: string;
  week_start: string;
  week_end: string;
  closed: boolean;
  /** Confirmed at close. Null while the week is still open. */
  saved: number | null;
  /** What that week asked for: its own frozen target, or the plan's. */
  target: number;
};

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
  /** What left the vault while this plan ran: withdrawals, vault-paid loans. */
  taken_out: number;
  /** saved - taken_out. What the plan put away AND kept. */
  net_saved: number;
  target_total: number;
  percent: number;
  met: boolean;
  finished: boolean;
  /** Filed away by the owner. Its dates are still taken, forever. */
  archived: boolean;
  notes: string | null;
  /** Its weeks, newest first, for the list that opens under it. */
  weeks: PlanWeek[];
  /** Its own stretches, so a finished plan can be opened and read like a live one. */
  milestones: Milestone[];
};

/**
 * How long a plan runs, said the way a person would say it.
 *
 * "1 months, 4 weeks" is two facts and a grammatical error where one fact was
 * wanted. The weeks are on the panel below already, so the length is enough.
 */
export function durationLabel(months: number): string {
  if (months % 12 === 0) {
    const years = months / 12;
    return years === 1 ? "1 year" : `${years} years`;
  }
  return months === 1 ? "1 month" : `${months} months`;
}

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
  /** The plan on screen: the one running, or the last one not yet filed away. */
  current: PlanResult | null;
  /** The plans before it, used only to know where the next one may start. */
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
              {durationLabel(plan.horizon_months)}, coming to{" "}
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

        {/* How far along the whole plan is, in one bar. The figures above say
            what it asks for; this says how much of it is done. */}
        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {aud(plan.net_saved)}
              <span className="ml-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                of {aud(plan.target_total)}
              </span>
            </p>
            <p
              className={`text-sm font-bold ${
                plan.met
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-slate-900 dark:text-slate-100"
              }`}
            >
              {plan.percent}%
            </p>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div
              className={`h-full rounded-full ${
                plan.met ? "bg-emerald-500" : "bg-sky-500"
              }`}
              style={{ width: `${Math.max(0, Math.min(100, plan.percent))}%` }}
            />
          </div>
        </div>

        <dl className="mt-5 grid gap-4 border-t border-slate-100 pt-4 text-sm dark:border-slate-800 sm:grid-cols-3">
          <Field label="Week 1 starts" value={shortDate(plan.starts_on)} />
          <Field label="Last week ends" value={shortDate(plan.ends_on)} />
          {/* What is really in the vault from this plan: every week it closed,
              less anything taken back out while it was running. Money sent to
              Colombia is still saved, so it is not deducted here. */}
          <Field
            label="Total saved"
            value={aud(plan.net_saved)}
            note={
              plan.taken_out > 0
                ? `${aud(plan.saved)} put away, ${aud(plan.taken_out)} taken out`
                : undefined
            }
          />
        </dl>
      </div>

      <PlanWeeks weeks={plan.weeks} weeklyTarget={plan.weekly_target} />

      {plan.finished && <Finished plan={plan} />}

      <DeletePlan plan={plan} />
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
  // Two buttons and nothing else until one is pressed. The paragraph that used
  // to explain both choices was longer than either of them.
  const [mode, setMode] = useState<null | "file" | "extend">(null);

  const tone = plan.met
    ? "bg-emerald-50 ring-emerald-200 dark:bg-emerald-950/30 dark:ring-emerald-900"
    : "bg-amber-50 ring-amber-200 dark:bg-amber-950/30 dark:ring-amber-900";
  const text = plan.met
    ? "text-emerald-900 dark:text-emerald-200"
    : "text-amber-900 dark:text-amber-200";

  return (
    <div className={`space-y-3 rounded-2xl p-5 ring-1 ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className={`text-sm font-semibold ${text}`}>
          {plan.met
            ? `Done, and you made it: ${aud(plan.net_saved)} of ${aud(
                plan.target_total,
              )}.`
            : `Done at ${aud(plan.net_saved)} of ${aud(plan.target_total)}, ${
                plan.percent
              }%.`}
        </h3>

        {mode === null && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setMode("file")}
              className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
            >
              File it away
            </button>
            <button
              onClick={() => setMode("extend")}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Keep it going
            </button>
          </div>
        )}
      </div>

      {mode === "file" && (
        <FileAway plan={plan} onCancel={() => setMode(null)} />
      )}
      {mode === "extend" && (
        <KeepGoing plan={plan} onCancel={() => setMode(null)} />
      )}
    </div>
  );
}

/** File it away: the history keeps it, and the page offers the next plan. */
function FileAway({
  plan,
  onCancel,
}: {
  plan: PlanResult;
  onCancel: () => void;
}) {
  const [state, action, pending] = useActionState(archivePlanAction, initial);

  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="id" value={plan.id} />
      <p className="text-xs text-slate-600 dark:text-slate-400">
        Its weeks and its result stay as they are. The next plan starts after{" "}
        {shortDate(plan.ends_on)}.
      </p>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
      >
        {pending ? "\u2026" : "File it away"}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="text-xs font-medium text-slate-500 hover:underline dark:text-slate-400"
      >
        Cancel
      </button>
      {state.error && (
        <span className="text-xs text-red-600 dark:text-red-400">
          {state.error}
        </span>
      )}
    </form>
  );
}

/** Keep it going: more months on the same plan, if the money is still coming. */
function KeepGoing({
  plan,
  onCancel,
}: {
  plan: PlanResult;
  onCancel: () => void;
}) {
  const [state, action, pending] = useActionState(extendPlanAction, initial);

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={plan.id} />
      <label className="block">
        <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          More months
        </span>
        <input
          name="months"
          type="number"
          min="1"
          max="120"
          defaultValue="3"
          autoFocus
          className="input w-24"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        {pending ? "\u2026" : "Extend"}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="pb-2 text-xs font-medium text-slate-500 hover:underline dark:text-slate-400"
      >
        Cancel
      </button>
      {state.error && (
        <span className="pb-2 text-xs text-red-600 dark:text-red-400">
          {state.error}
        </span>
      )}
    </form>
  );
}

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
              The last plan ended {shortDate(earliest)}, so this one starts after
              it. Filing a plan away does not free its dates: two plans can never
              cover the same week.
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
export function PlanHistory({ rows }: { rows: PlanResult[] }) {
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
              <th className="px-4 py-3 text-right font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((r) => (
              <HistoryRow key={r.id} plan={r} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * One plan that has been and gone, and everything it was, one click down.
 *
 * A finished plan is not a number, it is a stretch of weeks that went some way
 * or another, so it opens the same two things the live plan shows: its weeks,
 * green or red against their target, and its own milestones.
 */
function HistoryRow({ plan: r }: { plan: PlanResult }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <tr
        onClick={() => setOpen((v) => !v)}
        title={open ? "Hide this plan" : "Show its weeks and milestones"}
        className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800"
      >
                <td className="px-4 py-3">
                  <span className="mr-1 text-slate-400 dark:text-slate-500">
                    {open ? "▾" : "▸"}
                  </span>
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {r.name || durationLabel(r.horizon_months)}
                  </span>
                  <div className="text-[11px] text-slate-400 dark:text-slate-500">
                    {shortDate(r.starts_on)} to {shortDate(r.ends_on)}
                    {r.archived && " · filed away"}
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
                <td className="px-4 py-3 text-right">
                  {r.archived && <RestorePlan id={r.id} />}
                </td>
      </tr>

      {open && (
        <tr>
          <td colSpan={7} className="bg-slate-50 px-4 py-4 dark:bg-slate-950/40">
            <div className="space-y-4">
              <MilestoneCards milestones={r.milestones} compact />
              <PlanWeeks weeks={r.weeks} weeklyTarget={r.weekly_target} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * The plan's own weeks, folded away until they are asked for.
 *
 * Open by default it would be a wall of rows on top of the figures that
 * summarise it. Folded, it is the answer to the one question the summary cannot
 * answer: which weeks made their target and which did not. Green and red, and a
 * click straight into the week.
 */
function PlanWeeks({
  weeks,
  weeklyTarget,
}: {
  weeks: PlanWeek[];
  weeklyTarget: number;
}) {
  const [open, setOpen] = useState(false);
  if (weeks.length === 0) return null;

  const closed = weeks.filter((w) => w.closed);
  const met = closed.filter((w) => (w.saved ?? 0) >= w.target).length;

  return (
    <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-baseline justify-between gap-3 px-5 py-3 text-left"
      >
        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {open ? "▾" : "▸"} The weeks of this plan
          <span className="ml-2 text-xs font-normal text-slate-400 dark:text-slate-500">
            {weeks.length}
          </span>
        </span>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {closed.length === 0 ? (
            "None closed yet"
          ) : (
            <>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                {met}
              </span>{" "}
              on target ·{" "}
              <span className="font-semibold text-red-600 dark:text-red-400">
                {closed.length - met}
              </span>{" "}
              under
            </>
          )}
        </span>
      </button>

      {open && (
        <div className="overflow-x-auto border-t border-slate-100 dark:border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2 font-medium">Week</th>
                <th className="px-4 py-2 text-right font-medium">Saved</th>
                <th className="px-4 py-2 text-right font-medium">Target</th>
                <th className="px-4 py-2 text-right font-medium">Against</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {weeks.map((w) => {
                const target = w.target || weeklyTarget;
                const saved = w.saved;
                const madeIt = saved !== null && saved >= target;
                return (
                  <tr
                    key={w.id}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <td className="px-4 py-2">
                      <Link
                        href={`/savings/weeks/${w.id}`}
                        className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                      >
                        {shortDate(w.week_start)} to {shortDate(w.week_end)}
                      </Link>
                      {!w.closed && (
                        <span className="ml-2 text-[11px] text-slate-400 dark:text-slate-500">
                          still open
                        </span>
                      )}
                    </td>
                    <td
                      className={`px-4 py-2 text-right font-semibold ${
                        saved === null
                          ? "text-slate-400 dark:text-slate-500"
                          : madeIt
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {saved === null ? "–" : aud(saved)}
                    </td>
                    <td
                      className={`px-4 py-2 text-right ${
                        madeIt
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-slate-500 dark:text-slate-400"
                      }`}
                    >
                      {aud(target)}
                    </td>
                    <td
                      className={`px-4 py-2 text-right ${
                        saved === null
                          ? "text-slate-400 dark:text-slate-500"
                          : madeIt
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {saved === null
                        ? "–"
                        : `${saved - target >= 0 ? "+" : ""}${aud(saved - target)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Taking a filed plan back out.
 *
 * Nothing is lost either way: the weeks, the figures and the result stay where
 * they are. All this decides is whether the plan is the one on screen.
 */
function RestorePlan({ id }: { id: string }) {
  const [state, action, pending] = useActionState(archivePlanAction, initial);

  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="archived" value="false" />
      <button
        type="submit"
        disabled={pending}
        title={state.error ?? "Put it back at the top of the page"}
        className="rounded-md px-2 py-1 text-xs font-medium text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-60 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      >
        {pending ? "…" : "Take back out"}
      </button>
    </form>
  );
}

// -- small pieces -----------------------------------------------------------

function Field({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div>
      <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </dt>
      {note && (
        <dd className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
          {note}
        </dd>
      )}
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
function DeletePlan({ plan }: { plan: PlanResult }) {
  const [state, action, pending] = useActionState(deletePlanAction, initial);
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [force, setForce] = useState(false);

  // What a mis-click would cost: this plan's closed weeks are part of Vault
  // AUS, and deleting them takes that money out of the balance with nothing
  // left to point at. So the panel says the figure, and the name has to be
  // typed before the button does anything.
  const expected = plan.name || "DELETE";
  const [typed, setTyped] = useState("");
  const matches = typed.trim().toLowerCase() === expected.toLowerCase();

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
      <input type="hidden" name="id" value={plan.id} />
      <input type="hidden" name="expected_name" value={expected} />
      <h3 className="text-sm font-semibold text-red-900 dark:text-red-200">
        Delete the plan and start again
      </h3>
      <p className="text-xs text-red-900/80 dark:text-red-200/80">
        This deletes the plan and{" "}
        <span className="font-semibold">
          {plan.weeks_opened} {plan.weeks_opened === 1 ? "week" : "weeks"}
        </span>
        {plan.weeks_closed > 0 && (
          <>
            {" "}
            (<span className="font-semibold">{plan.weeks_closed} closed</span>)
          </>
        )}
        , with everything recorded on them: the work, the payments and the costs
        of each week. It cannot be undone.
      </p>

      {plan.saved > 0 && (
        <p className="rounded-lg bg-red-100 px-3 py-2 text-xs font-medium text-red-900 dark:bg-red-950/60 dark:text-red-200">
          Those weeks put {aud(plan.saved)} into Vault AUS. The vault keeps no
          balance of its own, so deleting them takes that straight back out of
          it. Everything else in the vault, the transfers to Colombia and what
          was taken out, stays exactly as it is.
        </p>
      )}

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

      <label className="block text-xs font-medium text-red-900 dark:text-red-200">
        <span className="mb-1 block">
          Type <span className="font-bold">{expected}</span> to confirm
        </span>
        <input
          name="typed_name"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          className="input max-w-xs"
        />
      </label>

      {/* Only shown once the server has refused: it means the vault would be
          left holding less than nothing, which is always a mistake unless it
          is deliberate. */}
      {state.error && state.error.includes("second box") && (
        <label className="flex items-center gap-2 text-xs font-medium text-red-900 dark:text-red-200">
          <input
            type="checkbox"
            name="force"
            value="true"
            checked={force}
            onChange={(e) => setForce(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          Delete it anyway, and leave the vault short
        </label>
      )}

      {state.error && (
        <p className="text-xs font-medium text-red-700 dark:text-red-300">
          {state.error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-red-300 px-4 py-2 text-xs font-medium text-red-700 hover:bg-red-100 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/60"
        >
          Keep it
        </button>
        <button
          type="submit"
          disabled={pending || !confirmed || !matches}
          className="rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
        >
          {pending ? "Deleting\u2026" : "Delete the plan"}
        </button>
      </div>
    </form>
  );
}
