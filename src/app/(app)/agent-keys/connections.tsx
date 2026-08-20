"use client";

import { useActionState } from "react";
import type { Connection } from "@/lib/oauth/store";
import { SCOPE_LABELS, type Scope } from "@/lib/gateway/scopes";
import {
  revokeConnectionAction,
  deleteConnectionAction,
  type KeyActionState,
} from "./actions";

const initial: KeyActionState = { ok: false };

/** UTC ISO -> "YYYY-MM-DD HH:MM" (stable, no hydration mismatch). */
const fmt = (iso: string | null): string =>
  iso ? `${iso.slice(0, 16).replace("T", " ")} UTC` : "never";

/**
 * Assistants that connected by approving a consent screen instead of being
 * handed a key.
 *
 * Shown next to the keys rather than on a page of their own: from the owner's
 * side these are the same thing, something that can act on the business, and
 * the useful question is always "what is connected right now".
 */
export function Connections({ connections }: { connections: Connection[] }) {
  const live = connections.filter((c) => !c.revoked_at);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-slate-50 p-4 text-sm ring-1 ring-slate-200 dark:bg-slate-900/50 dark:ring-slate-800">
        <p className="font-semibold text-slate-900 dark:text-slate-100">
          Connected by approval
        </p>
        <p className="mt-1 text-slate-600 dark:text-slate-400">
          These assistants were pointed at this app and you approved them in the
          browser, so no key was ever copied anywhere. They hold a token that
          expires and renews itself, and revoking one stops it immediately.
        </p>
      </div>

      {connections.length === 0 ? (
        <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Nothing connected this way yet. Point an assistant at this app and it
            will bring you here to approve it.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">Assistant</th>
                <th className="px-4 py-3 font-medium">Can</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Last used</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {connections.map((c) => (
                <Row key={c.id} connection={c} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {live.length > 0 && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {live.length} active {live.length === 1 ? "connection" : "connections"}.
        </p>
      )}
    </div>
  );
}

function Row({ connection }: { connection: Connection }) {
  const [revokeState, revoke, revoking] = useActionState(
    revokeConnectionAction,
    initial,
  );
  const [deleteState, remove, removing] = useActionState(
    deleteConnectionAction,
    initial,
  );
  const revoked = !!connection.revoked_at;
  const error = revokeState.error ?? deleteState.error;

  return (
    <tr className={revoked ? "opacity-60" : undefined}>
      <td className="px-4 py-3">
        <p className="font-medium text-slate-900 dark:text-slate-100">
          {connection.client_name}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          signs as {connection.label}
        </p>
        {error && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {connection.scopes.map((s) => (
            <span
              key={s}
              title={SCOPE_LABELS[s as Scope]?.detail}
              className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            >
              {s}
            </span>
          ))}
        </div>
      </td>
      <td className="px-4 py-3">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            revoked
              ? "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
              : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400"
          }`}
        >
          {revoked ? "revoked" : "active"}
        </span>
      </td>
      <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
        {fmt(connection.last_used_at)}
      </td>
      <td className="px-4 py-3 text-right">
        {revoked ? (
          <form action={remove} className="inline">
            <input type="hidden" name="id" value={connection.id} />
            <button
              type="submit"
              disabled={removing}
              className="text-xs font-medium text-slate-500 transition hover:text-red-600 disabled:opacity-50 dark:text-slate-400"
            >
              {removing ? "Removing…" : "Remove"}
            </button>
          </form>
        ) : (
          <form action={revoke} className="inline">
            <input type="hidden" name="id" value={connection.id} />
            <button
              type="submit"
              disabled={revoking}
              className="text-xs font-medium text-red-600 transition hover:text-red-700 disabled:opacity-50 dark:text-red-400"
            >
              {revoking ? "Revoking…" : "Revoke"}
            </button>
          </form>
        )}
      </td>
    </tr>
  );
}
