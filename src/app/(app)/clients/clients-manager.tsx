"use client";

import { useActionState, useEffect, useState } from "react";
import type { ClientWithIssuer, Issuer } from "@/lib/types";
import {
  saveClientAction,
  deleteClientAction,
  type ActionState,
} from "./actions";

const initial: ActionState = { ok: false };

const BLANK = "–"; // en dash, for a cell with nothing in it

function formatRate(rate: number | null) {
  if (rate === null) return BLANK;
  return `AUD ${rate.toFixed(2)}`;
}

export function ClientsManager({
  clients,
  issuers,
  perClientDefaults,
  defaultDescription,
}: {
  clients: ClientWithIssuer[];
  issuers: Issuer[];
  /**
   * Whether this business agrees a standard service and rate with each client,
   * the way Awesome does. When it does not, a client is only a name and an
   * address: what the work was and what it cost are said on the invoice line,
   * and asking for them twice is just a form to fill in for nothing.
   */
  perClientDefaults: boolean;
  defaultDescription: string;
}) {
  // null = closed; "new" = add; otherwise the client being edited.
  const [editing, setEditing] = useState<ClientWithIssuer | "new" | null>(null);

  // Which of YOUR ABNs bills this client. With a single ABN there is nothing to
  // choose and nothing to show, and a column headed "ABN" on a page about
  // clients reads as the client's own ABN, which this app never asks for.
  const showIssuer = issuers.length > 1;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setEditing("new")}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          + Add client
        </button>
      </div>

      <div className="overflow-x-auto rounded-2xl bg-white dark:bg-slate-900 shadow-sm ring-1 ring-slate-200 dark:ring-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-800 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3 font-medium">Client</th>
              <th className="px-4 py-3 font-medium">Address</th>
              {showIssuer && (
                <th className="px-4 py-3 font-medium">Billed by</th>
              )}
              {perClientDefaults && (
                <th className="px-4 py-3 text-right font-medium">Rate</th>
              )}
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {clients.length === 0 && (
              <tr>
                <td
                  colSpan={3 + (showIssuer ? 1 : 0) + (perClientDefaults ? 1 : 0)}
                  className="px-4 py-8 text-center text-slate-400 dark:text-slate-500"
                >
                  No clients yet.
                </td>
              </tr>
            )}
            {clients.map((c) => (
              <tr
                key={c.id}
                className="hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-900 dark:text-slate-100">
                    {c.name}
                  </div>
                  {c.email && (
                    <div className="text-xs text-slate-400 dark:text-slate-500">
                      {c.email}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                  {[c.address_line, c.suburb, c.state, c.postcode]
                    .filter(Boolean)
                    .join(", ") || BLANK}
                </td>
                {showIssuer && (
                  <td className="px-4 py-3">
                    {c.issuer ? (
                      <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-700 dark:text-slate-300">
                        {c.issuer.short_name}
                      </span>
                    ) : (
                      <span className="text-slate-400 dark:text-slate-500">
                        {BLANK}
                      </span>
                    )}
                  </td>
                )}
                {perClientDefaults && (
                  <td className="px-4 py-3 text-right font-medium text-slate-900 dark:text-slate-100">
                    {formatRate(c.default_rate)}
                  </td>
                )}
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setEditing(c)}
                      className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      Edit
                    </button>
                    <DeleteButton id={c.id} name={c.name} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing !== null && (
        <ClientDialog
          client={editing === "new" ? null : editing}
          issuers={issuers}
          perClientDefaults={perClientDefaults}
          defaultDescription={defaultDescription}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ClientDialog({
  client,
  issuers,
  perClientDefaults,
  defaultDescription,
  onClose,
}: {
  client: ClientWithIssuer | null;
  issuers: Issuer[];
  perClientDefaults: boolean;
  defaultDescription: string;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(saveClientAction, initial);

  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {client ? "Edit client" : "Add client"}
        </h2>

        <form action={action} className="mt-4 space-y-4">
          {client && <input type="hidden" name="id" value={client.id} />}

          {/* A hidden field is not the same as no field: the action reads the
              form, so leaving these out would quietly erase what a business
              had already agreed with this client. */}
          {!perClientDefaults && client && (
            <>
              <input
                type="hidden"
                name="default_rate"
                value={client.default_rate ?? ""}
              />
              <input
                type="hidden"
                name="default_description"
                value={client.default_description ?? ""}
              />
            </>
          )}

          <Field label="Name" required>
            <input
              name="name"
              required
              defaultValue={client?.name ?? ""}
              className="input"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            {/* With one ABN there is nothing to choose: it is filled in for
                them so every client still carries a default issuer. */}
            {issuers.length === 1 ? (
              <input
                type="hidden"
                name="default_issuer_id"
                value={issuers[0].id}
              />
            ) : (
              <Field label="Billed by (your ABN)">
                <select
                  name="default_issuer_id"
                  defaultValue={client?.default_issuer_id ?? ""}
                  className="input"
                >
                  <option value="">(none)</option>
                  {issuers.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.short_name} ({i.abn})
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {perClientDefaults && (
              <Field label="Rate (AUD)">
                <input
                  name="default_rate"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={client?.default_rate ?? ""}
                  className="input"
                />
              </Field>
            )}
          </div>

          {/* Only for a business that agrees the work in advance. Everyone else
              says what it was on the invoice line, where it belongs. */}
          {perClientDefaults && (
            <Field label="Default service">
              <input
                name="default_description"
                defaultValue={client?.default_description ?? defaultDescription}
                className="input"
              />
            </Field>
          )}

          <Field label="Email">
            <input
              name="email"
              type="email"
              defaultValue={client?.email ?? ""}
              className="input"
            />
          </Field>

          <Field label="Address">
            <input
              name="address_line"
              defaultValue={client?.address_line ?? ""}
              placeholder="Street"
              className="input"
            />
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Suburb">
              <input
                name="suburb"
                defaultValue={client?.suburb ?? ""}
                className="input"
              />
            </Field>
            <Field label="State">
              <input
                name="state"
                defaultValue={client?.state ?? "NSW"}
                className="input"
              />
            </Field>
            <Field label="Postcode">
              <input
                name="postcode"
                defaultValue={client?.postcode ?? ""}
                className="input"
              />
            </Field>
          </div>

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
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteButton({ id, name }: { id: string; name: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(deleteClientAction, initial);

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
    <div className="flex flex-col items-end gap-1">
      <form action={action} className="flex items-center gap-1">
        <input type="hidden" name="id" value={id} />
        <span className="text-xs text-slate-500 dark:text-slate-400">
          Delete {name}?
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
      </form>
      {/* A refusal is worth reading. It used to be a bare "!", which told
          somebody with an invoiced client nothing about why nothing happened. */}
      {state.error && (
        <p className="max-w-xs rounded-lg bg-red-50 px-3 py-2 text-left text-xs text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900">
          {state.error}
        </p>
      )}
    </div>
  );
}

function Field({
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
