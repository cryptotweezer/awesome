"use client";

import { aud, shortDate } from "@/lib/savings";
import type { Milestone } from "@/lib/data/savings-progress";

/**
 * The stretches a plan is read at, drawn once and used twice: for the plan on
 * screen now, and inside a finished plan in the history.
 *
 * Each card measures ITS OWN stretch and nothing before it. Cumulative was not
 * just wrong, it was misleading: week 1 closing put week 4 at 25 per cent
 * before week 4 had begun. A stretch that has not started reads zero, in grey,
 * because nothing is owed by a month that has not happened.
 */
export function MilestoneCards({
  milestones,
  compact = false,
}: {
  milestones: Milestone[];
  /** Inside a history row, where the cards sit under a table. */
  compact?: boolean;
}) {
  if (milestones.length === 0) return null;

  return (
    <div
      className={`grid gap-3 ${
        compact
          ? "sm:grid-cols-3 xl:grid-cols-6"
          : "gap-4 sm:grid-cols-2 xl:grid-cols-4"
      }`}
    >
      {milestones.map((m) => {
        const pct = Math.max(0, Math.min(100, m.percent));
        const onTrack = m.saved >= m.due_so_far;
        return (
          <div
            key={m.key}
            className={`rounded-2xl bg-white shadow-sm ring-1 dark:bg-slate-900 ${
              compact ? "p-3" : "p-4"
            } ${
              m.major
                ? "ring-2 ring-slate-300 dark:ring-slate-600"
                : "ring-slate-200 dark:ring-slate-800"
            }`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <p
                className={`font-semibold text-slate-900 dark:text-slate-100 ${
                  m.major && !compact ? "text-base" : "text-sm"
                }`}
              >
                {m.label}
              </p>
              <span
                className={`text-xs font-semibold ${
                  m.not_started
                    ? "text-slate-400 dark:text-slate-500"
                    : m.reached
                      ? "text-emerald-600 dark:text-emerald-400"
                      : onTrack
                        ? "text-slate-500 dark:text-slate-400"
                        : "text-red-600 dark:text-red-400"
                }`}
              >
                {pct}%
              </span>
            </div>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              {shortDate(m.starts_on)} to {shortDate(m.ends_on)}
              {m.not_started && " · not started"}
            </p>

            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div
                className={`h-full rounded-full ${
                  m.not_started
                    ? "bg-slate-300 dark:bg-slate-700"
                    : m.reached
                      ? "bg-emerald-500"
                      : onTrack
                        ? "bg-sky-500"
                        : "bg-red-500"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>

            <p className="mt-2 text-sm font-bold text-slate-900 dark:text-slate-100">
              {aud(m.saved)}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              of {aud(m.target)}
              {m.in_future && !m.not_started && (
                <>
                  {" "}
                  ·{" "}
                  <span
                    className={
                      onTrack
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    }
                  >
                    {onTrack
                      ? "on track"
                      : `${aud(m.due_so_far - m.saved)} behind`}
                  </span>
                </>
              )}
            </p>
          </div>
        );
      })}
    </div>
  );
}
