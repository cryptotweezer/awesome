"use client";

import Link from "next/link";
import { useState } from "react";
import { aud } from "@/lib/savings";
import type { WeekState } from "@/lib/types";

export type OpenSummary = {
  id: string;
  week_start: string;
  week_end: string;
  rotation_week: number;
  state: WeekState;
  income: number;
  expected_income: number;
  outstanding: number;
  expenses: number;
  saved: number;
  surplus: number;
  target: number;
  against_target: number;
  done: number;
  expected: number;
  skipped: number;
};

/**
 * Every week still open, oldest first, collapsed by default.
 *
 * These pile up on purpose: clients pay monthly or every six weeks, so a week
 * can be finished as work and unfinished as money for a long time. Collapsed,
 * because the list is a queue to work through and not something to read; open,
 * because what each one is waiting on is the point.
 */
export function OpenWeeks({ weeks }: { weeks: OpenSummary[] }) {
  const [open, setOpen] = useState(true);

  const waiting = weeks.reduce((s, w) => s + w.outstanding, 0);
  const pending = weeks.filter((w) => w.state === "pending").length;

  return (
    <section className="space-y-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-baseline justify-between gap-3 text-left"
      >
        <span className="flex items-baseline gap-2">
          <span className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {open ? "▾" : "▸"} Open weeks
          </span>
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
            {weeks.length}
          </span>
        </span>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {pending > 0 && (
            <>
              {pending} ended and waiting
              {waiting > 0 && " · "}
            </>
          )}
          {waiting > 0 && (
            <span className="font-medium text-amber-600 dark:text-amber-400">
              {aud(waiting)} still to arrive
            </span>
          )}
        </span>
      </button>

      {open &&
        (weeks.length === 0 ? (
          <p className="rounded-2xl bg-white p-6 text-sm text-slate-500 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:ring-slate-800">
            Nothing open. Every week is closed.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Week</th>
                  <th className="px-4 py-3 font-medium">State</th>
                  <th className="px-4 py-3 font-medium">Work</th>
                  <th className="px-4 py-3 text-right font-medium">In</th>
                  <th className="px-4 py-3 text-right font-medium">
                    To arrive
                  </th>
                  <th className="px-4 py-3 text-right font-medium">Out</th>
                  <th className="px-4 py-3 text-right font-medium">Excess</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {weeks.map((w) => (
                  <tr
                    key={w.id}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <td className="px-4 py-3">
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        {w.week_start} to {w.week_end}
                      </span>
                      <div className="text-[11px] text-slate-400 dark:text-slate-500">
                        Week {w.rotation_week}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                          w.state === "pending"
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                            : "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300"
                        }`}
                      >
                        {w.state}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400">
                      {w.done} done
                      {w.expected > 0 && ` · ${w.expected} to go`}
                      {w.skipped > 0 && ` · ${w.skipped} cancelled`}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-400">
                      {aud(w.expected_income)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {w.outstanding > 0 ? (
                        <span className="font-medium text-amber-600 dark:text-amber-400">
                          {aud(w.outstanding)}
                        </span>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500">
                          –
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-rose-400 dark:text-rose-400/90">
                      {aud(w.expenses)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-semibold ${
                        w.surplus < 0
                          ? "text-red-600 dark:text-red-400"
                          : "text-slate-900 dark:text-slate-100"
                      }`}
                    >
                      {aud(w.surplus)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/savings/weeks/${w.id}`}
                        className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </section>
  );
}
