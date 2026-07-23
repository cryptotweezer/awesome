"use client";

import { useActionState, useEffect, useState } from "react";
import type { ClientWithIssuer, Issuer } from "@/lib/types";
import {
  saveClientAction,
  deleteClientAction,
  type ActionState,
} from "./actions";

const initial: ActionState = { ok: false };

function formatRate(rate: number | null) {
  if (rate === null) return "—";
  return `AUD ${rate.toFixed(2)}`;
}

export function ClientsManager({
  clients,
  issuers,
}: {
  clients: ClientWithIssuer[];
  issuers: Issuer[];
}) {
  // null = closed; "new" = add; otherwise the client being edited.
  const [editing, setEditing] = useState<ClientWithIssuer | "new" | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setEditing("new")}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
        >
          + Add client
        </button>
      </div>

      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Client</th>
              <th className="px-4 py-3 font-medium">Address</th>
              <th className="px-4 py-3 font-medium">ABN</th>
              <th className="px-4 py-3 text-right font-medium">Rate</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {clients.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  No clients yet.
                </td>
              </tr>
            )}
            {clients.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-900">{c.name}</div>
                  {c.email && (
                    <div className="text-xs text-slate-400">{c.email}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {[c.address_line, c.suburb, c.state, c.postcode]
                    .filter(Boolean)
                    .join(", ") || "—"}
                </td>
                <td className="px-4 py-3">
                  {c.issuer ? (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                      {c.issuer.short_name}
                    </span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-medium text-slate-900">
                  {formatRate(c.default_rate)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setEditing(c)}
                      className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
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
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ClientDialog({
  client,
  issuers,
  onClose,
}: {
  client: ClientWithIssuer | null;
  issuers: Issuer[];
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(saveClientAction, initial);

  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-900">
          {client ? "Edit client" : "Add client"}
        </h2>

        <form action={action} className="mt-4 space-y-4">
          {client && <input type="hidden" name="id" value={client.id} />}

          <Field label="Name" required>
            <input
              name="name"
              required
              defaultValue={client?.name ?? ""}
              className="input"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="ABN (issuer)">
              <select
                name="default_issuer_id"
                defaultValue={client?.default_issuer_id ?? ""}
                className="input"
              >
                <option value="">— none —</option>
                {issuers.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.short_name} ({i.abn})
                  </option>
                ))}
              </select>
            </Field>
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
          </div>

          <Field label="Default service">
            <input
              name="default_description"
              defaultValue={client?.default_description ?? "Cleaning Service"}
              className="input"
            />
          </Field>

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
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
              {state.error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
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
        className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
      >
        Delete
      </button>
    );
  }

  return (
    <form action={action} className="flex items-center gap-1">
      <input type="hidden" name="id" value={id} />
      <span className="text-xs text-slate-500" title={name}>
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
        className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
      >
        No
      </button>
      {state.error && <span className="text-xs text-red-600">!</span>}
    </form>
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
      <span className="mb-1 block text-xs font-medium text-slate-600">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
    </label>
  );
}
