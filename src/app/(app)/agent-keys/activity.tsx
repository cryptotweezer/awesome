import type { AgentCall } from "@/lib/gateway/audit";

/** UTC ISO -> "YYYY-MM-DD HH:MM" (stable, no hydration mismatch). */
const when = (iso: string): string => `${iso.slice(0, 16).replace("T", " ")} UTC`;

const OUTCOME: Record<AgentCall["outcome"], { label: string; className: string }> = {
  ok: {
    label: "Done",
    className:
      "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
  },
  denied: {
    label: "Refused",
    className:
      "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
  },
  error: {
    label: "Failed",
    className: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400",
  },
};

const VIA: Record<AgentCall["via"], string> = {
  key: "key",
  oauth: "approved",
  session: "here",
};

/**
 * What the agents actually did, most recent first.
 *
 * Most of the value of this is not forensic. It is that the owner can look at
 * what they connected and see it working, which is the fastest way to trust the
 * feature and the fastest way to notice something behaving oddly. The refusals
 * are the rows worth reading: a run of them is an assistant asking for
 * something it was never granted.
 */
export function Activity({ calls }: { calls: AgentCall[] }) {
  if (calls.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Nothing yet. Every call an agent makes shows up here, including the
          ones it was not allowed to make.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
          <tr>
            <th className="px-4 py-3 font-medium">When</th>
            <th className="px-4 py-3 font-medium">Who</th>
            <th className="px-4 py-3 font-medium">Did</th>
            <th className="px-4 py-3 font-medium">Outcome</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {calls.map((call) => {
            const badge = OUTCOME[call.outcome];
            return (
              <tr key={call.id}>
                <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                  {when(call.at)}
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-900 dark:text-slate-100">
                    {call.credential_label}
                  </div>
                  <div className="text-xs text-slate-400 dark:text-slate-500">
                    {VIA[call.via]}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="font-mono text-xs text-slate-700 dark:text-slate-300">
                    {call.tool}
                  </div>
                  {call.target && (
                    <div className="text-xs text-slate-400 dark:text-slate-500">
                      {call.target}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}
                  >
                    {badge.label}
                  </span>
                  {call.detail && (
                    <div className="mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400">
                      {call.detail}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
