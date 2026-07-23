"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ClientWithIssuer, Issuer } from "@/lib/types";
import { formatAUD, formatDate } from "@/lib/format";

export type InvoiceFormPayload = {
  client_id: string;
  issuer_id: string;
  invoice_date: string;
  internal_notes: string | null;
  items: {
    description: string;
    service_date: string | null;
    quantity: number;
    rate: number;
  }[];
};

export type InvoiceFormResult = { ok: boolean; id?: string; error?: string };

type Line = {
  description: string;
  service_date: string;
  quantity: string;
  rate: string;
};

export type InvoiceFormInitial = {
  client_id: string;
  issuer_id: string;
  invoice_date: string;
  internal_notes: string;
  lines: Line[];
};

const today = new Date().toISOString().slice(0, 10);

function emptyLine(serviceDate = ""): Line {
  return {
    description: "Cleaning Service",
    service_date: serviceDate,
    quantity: "1",
    rate: "",
  };
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function InvoiceForm({
  clients,
  issuers,
  action,
  nextNumber = null,
  initial = null,
  submitLabel = "Create invoice",
}: {
  clients: ClientWithIssuer[];
  issuers: Issuer[];
  action: (payload: InvoiceFormPayload) => Promise<InvoiceFormResult>;
  nextNumber?: number | null;
  initial?: InvoiceFormInitial | null;
  submitLabel?: string;
}) {
  const isEdit = initial != null;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [clientId, setClientId] = useState(initial?.client_id ?? "");
  const [issuerId, setIssuerId] = useState(initial?.issuer_id ?? "");
  const [invoiceDate, setInvoiceDate] = useState(initial?.invoice_date ?? today);
  const [notes, setNotes] = useState(initial?.internal_notes ?? "");
  const [lines, setLines] = useState<Line[]>(
    initial?.lines?.length ? initial.lines : [emptyLine()],
  );

  function onClientChange(id: string) {
    setClientId(id);
    const c = clients.find((x) => x.id === id);
    if (!c) return;
    setIssuerId(c.default_issuer_id ?? "");
    // In edit mode, don't wipe the line items the user is correcting.
    if (!isEdit) {
      setLines([
        {
          description: c.default_description || "Cleaning Service",
          service_date: "",
          quantity: "1",
          rate: c.default_rate != null ? String(c.default_rate) : "",
        },
      ]);
    }
  }

  function updateLine(i: number, field: keyof Line, value: string) {
    setLines((prev) =>
      prev.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)),
    );
  }

  const total = useMemo(
    () =>
      lines.reduce(
        (sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.rate) || 0),
        0,
      ),
    [lines],
  );

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await action({
        client_id: clientId,
        issuer_id: issuerId,
        invoice_date: invoiceDate,
        internal_notes: notes,
        items: lines.map((l) => ({
          description: l.description,
          service_date: l.service_date || null,
          quantity: Number(l.quantity) || 0,
          rate: Number(l.rate) || 0,
        })),
      });
      if (res.ok && res.id) {
        router.push(`/invoices/${res.id}`);
        router.refresh();
      } else {
        setError(res.error ?? "Something went wrong.");
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Client *
          </span>
          <select
            value={clientId}
            onChange={(e) => onClientChange(e.target.value)}
            className="input"
          >
            <option value="">— select a client —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            ABN (issuer) *
          </span>
          <select
            value={issuerId}
            onChange={(e) => setIssuerId(e.target.value)}
            className="input"
          >
            <option value="">— select —</option>
            {issuers.map((i) => (
              <option key={i.id} value={i.id}>
                {i.short_name} ({i.abn})
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Invoice date
          </span>
          <input
            type="date"
            value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)}
            className="input"
          />
        </label>

        <div className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Terms / Due date
          </span>
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
            NET7 · due {formatDate(addDays(invoiceDate, 7))}
          </p>
        </div>
      </div>

      {/* Line items */}
      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Services</h2>
          <button
            type="button"
            onClick={() =>
              setLines((p) => [...p, emptyLine(p[0]?.service_date ?? "")])
            }
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            + Add line
          </button>
        </div>

        <div className="space-y-2">
          <div className="hidden grid-cols-12 gap-2 px-1 text-xs font-medium text-slate-400 sm:grid">
            <span className="col-span-5">Description</span>
            <span className="col-span-3">Service date</span>
            <span className="col-span-1 text-right">Qty</span>
            <span className="col-span-2 text-right">Rate</span>
            <span className="col-span-1"></span>
          </div>

          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 items-center gap-2">
              <input
                value={l.description}
                onChange={(e) => updateLine(i, "description", e.target.value)}
                placeholder="Cleaning Service"
                className="input col-span-12 sm:col-span-5"
              />
              <input
                type="date"
                value={l.service_date}
                onChange={(e) => updateLine(i, "service_date", e.target.value)}
                className="input col-span-6 sm:col-span-3"
              />
              <input
                type="number"
                min="0"
                step="1"
                value={l.quantity}
                onChange={(e) => updateLine(i, "quantity", e.target.value)}
                className="input col-span-2 text-right sm:col-span-1"
              />
              <input
                type="number"
                min="0"
                step="0.01"
                value={l.rate}
                onChange={(e) => updateLine(i, "rate", e.target.value)}
                placeholder="0.00"
                className="input col-span-3 text-right sm:col-span-2"
              />
              <button
                type="button"
                onClick={() =>
                  setLines((p) =>
                    p.length > 1 ? p.filter((_, idx) => idx !== i) : p,
                  )
                }
                disabled={lines.length === 1}
                className="col-span-1 rounded-md px-2 py-2 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                title="Remove line"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <div className="mt-4 flex justify-end border-t border-slate-100 pt-4">
          <div className="text-right">
            <span className="text-xs font-medium text-slate-500">Total</span>
            <p className="text-xl font-bold text-slate-900">
              {formatAUD(total)}
            </p>
          </div>
        </div>
      </div>

      {/* Internal notes */}
      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Internal notes (not printed on the invoice)
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="e.g. windows in the living room; rescheduled from the 13th…"
            className="input"
          />
        </label>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3">
        {!isEdit && nextNumber != null && (
          <p className="mr-auto text-xs text-slate-400">
            This invoice will be #{nextNumber} — the final number is assigned
            when you save.
          </p>
        )}
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
        >
          {pending ? (isEdit ? "Saving…" : "Creating…") : submitLabel}
        </button>
      </div>
    </div>
  );
}
