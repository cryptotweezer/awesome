"use client";

import { useActionState, useEffect, useState } from "react";
import type { AgentKey } from "@/lib/types";
import {
  mintKeyAction,
  revokeKeyAction,
  reactivateKeyAction,
  deleteKeyAction,
  type KeyActionState,
} from "./actions";

const initial: KeyActionState = { ok: false };

/** UTC ISO -> "YYYY-MM-DD HH:MM" (stable, no hydration mismatch). */
function fmt(iso: string | null): string {
  return iso ? `${iso.slice(0, 16).replace("T", " ")} UTC` : "never";
}

export function KeysManager({ keys }: { keys: AgentKey[] }) {
  const [adding, setAdding] = useState(false);
  const [minted, setMinted] = useState<{ label: string; key: string } | null>(
    null,
  );

  return (
    <div className="space-y-4">
      {minted && (
        <MintedBanner minted={minted} onDismiss={() => setMinted(null)} />
      )}

      <div className="rounded-2xl bg-slate-50 dark:bg-slate-900/50 p-4 text-sm text-slate-600 dark:text-slate-400 ring-1 ring-slate-200 dark:ring-slate-800">
        Give each agent its own key. It sends it as{" "}
        <code className="rounded bg-slate-200 dark:bg-slate-800 px-1 py-0.5 text-xs">
          Authorization: Bearer &lt;key&gt;
        </code>{" "}
        to{" "}
        <code className="rounded bg-slate-200 dark:bg-slate-800 px-1 py-0.5 text-xs">
          /api/agent/&lt;tool&gt;
        </code>{" "}
        (REST) or{" "}
        <code className="rounded bg-slate-200 dark:bg-slate-800 px-1 py-0.5 text-xs">
          /api/mcp
        </code>{" "}
        (MCP). Revoke one anytime without touching the others.
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => setAdding(true)}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          + New key
        </button>
      </div>

      <div className="overflow-x-auto rounded-2xl bg-white dark:bg-slate-900 shadow-sm ring-1 ring-slate-200 dark:ring-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-800 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3 font-medium">Agent</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-4 py-3 font-medium">Last used</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {keys.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-slate-400 dark:text-slate-500"
                >
                  No keys yet. Create one for each agent.
                </td>
              </tr>
            )}
            {keys.map((k) => (
              <tr
                key={k.id}
                className="hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                  {k.label}
                </td>
                <td className="px-4 py-3">
                  {k.is_active ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                      Active
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      Revoked
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                  {fmt(k.created_at)}
                </td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                  {fmt(k.last_used_at)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <ToggleButton keyRow={k} />
                    <DeleteButton id={k.id} label={k.label} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adding && (
        <MintDialog
          onClose={() => setAdding(false)}
          onMinted={(m) => {
            setMinted(m);
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}

function MintedBanner({
  minted,
  onDismiss,
}: {
  minted: { label: string; key: string };
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(minted.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/40 p-4 ring-1 ring-amber-200 dark:ring-amber-900">
      <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
        Key for {minted.label} — copy it now, it is shown only once.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded-lg bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-800 dark:text-slate-200 ring-1 ring-amber-200 dark:ring-amber-900">
          {minted.key}
        </code>
        <button
          onClick={copy}
          className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-medium text-white hover:bg-amber-700"
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          onClick={onDismiss}
          className="rounded-lg border border-amber-300 dark:border-amber-800 px-3 py-2 text-xs font-medium text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40"
        >
          Done
        </button>
      </div>
    </div>
  );
}

function MintDialog({
  onClose,
  onMinted,
}: {
  onClose: () => void;
  onMinted: (m: { label: string; key: string }) => void;
}) {
  const [state, action, pending] = useActionState(mintKeyAction, initial);

  useEffect(() => {
    if (state.ok && state.key && state.label) {
      onMinted({ key: state.key, label: state.label });
    }
  }, [state, onMinted]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          New agent key
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          The label signs that agent&apos;s invoices (created_by).
        </p>

        <form action={action} className="mt-4 space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              Agent label <span className="text-red-500">*</span>
            </span>
            <input
              name="label"
              required
              placeholder="Claude, Codex, Emma, OpenClaw…"
              className="input"
            />
          </label>

          {state.error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900">
              {state.error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300 disabled:opacity-60"
            >
              {pending ? "Creating…" : "Create key"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ToggleButton({ keyRow }: { keyRow: AgentKey }) {
  const [state, action, pending] = useActionState(
    keyRow.is_active ? revokeKeyAction : reactivateKeyAction,
    initial,
  );

  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={keyRow.id} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-60"
      >
        {pending ? "…" : keyRow.is_active ? "Revoke" : "Reactivate"}
      </button>
      {state.error && <span className="ml-1 text-xs text-red-600">!</span>}
    </form>
  );
}

function DeleteButton({ id, label }: { id: string; label: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(deleteKeyAction, initial);

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
      <span className="text-xs text-slate-500 dark:text-slate-400" title={label}>
        Sure?
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
        className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
      >
        No
      </button>
      {state.error && <span className="text-xs text-red-600">!</span>}
    </form>
  );
}
