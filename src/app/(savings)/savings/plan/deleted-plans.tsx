"use client";

import { useActionState } from "react";
import { aud, shortDate } from "@/lib/savings";
import type { DeletedPlan } from "@/lib/data/savings-plan";
import { restorePlanAction, type ActionState } from "./actions";

const initial: ActionState = { ok: false };

/**
 * The thirty days after a plan is deleted.
 *
 * Deleting a plan takes its weeks and the part of the vault they had filled,
 * and there is no other copy of what was done each day. So the rows are set
 * aside rather than destroyed, and this is the only place that says so. After
 * thirty days the daily cron clears them and the window closes.
 */
export function DeletedPlans({
  rows,
  today,
}: {
  rows: DeletedPlan[];
  /** Today in the business's timezone, so "days left" is not read off a clock. */
  today: string;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Recently deleted
        </h2>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          Kept for thirty days, then gone for good. Putting one back restores its
          weeks, the work recorded on them and what they saved, straight back
          into the vault.
        </p>
      </div>

      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3 font-medium">Plan</th>
              <th className="px-4 py-3 font-medium">Deleted</th>
              <th className="px-4 py-3 text-right font-medium">Weeks</th>
              <th className="px-4 py-3 text-right font-medium">It had saved</th>
              <th className="px-4 py-3 text-right font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((r) => (
              <Row key={r.id} row={r} today={today} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Row({ row, today }: { row: DeletedPlan; today: string }) {
  const [state, action, pending] = useActionState(restorePlanAction, initial);
  const day = row.deleted_at.slice(0, 10);
  // Thirty days from the day it went, so the screen says how long is left
  // rather than making somebody count. Both dates are plain strings: reading a
  // clock while rendering gives two different answers on the server and in the
  // browser.
  const gone = Math.floor(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) /
      86_400_000,
  );
  const left = Math.max(0, 30 - gone);

  return (
    <tr>
      <td className="px-4 py-3">
        <span className="font-medium text-slate-900 dark:text-slate-100">
          {row.name || "A plan"}
        </span>
        <div className="text-[11px] text-slate-400 dark:text-slate-500">
          {shortDate(row.starts_on)} to {shortDate(row.ends_on)}
        </div>
      </td>
      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
        {shortDate(day)}
        <div className="text-[11px] text-slate-400 dark:text-slate-500">
          {left === 0
            ? "goes today"
            : `${left} ${left === 1 ? "day" : "days"} left`}
          {row.deleted_by && ` · by ${row.deleted_by}`}
        </div>
      </td>
      <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400">
        {row.weeks}
      </td>
      <td className="px-4 py-3 text-right font-semibold text-slate-900 dark:text-slate-100">
        {aud(row.saved)}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-2">
          {state.error && (
            <span className="text-xs text-red-600 dark:text-red-400">
              {state.error}
            </span>
          )}
          <form action={action} className="inline">
            <input type="hidden" name="id" value={row.id} />
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {pending ? "…" : "Put it back"}
            </button>
          </form>
          <form action={action} className="inline">
            <input type="hidden" name="id" value={row.id} />
            <input type="hidden" name="forget" value="true" />
            <button
              type="submit"
              disabled={pending}
              title="Remove it now instead of waiting the thirty days"
              className="rounded-md px-2 py-1 text-xs font-medium text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-60 dark:hover:bg-red-950/40 dark:hover:text-red-400"
            >
              Forget it
            </button>
          </form>
        </div>
      </td>
    </tr>
  );
}
