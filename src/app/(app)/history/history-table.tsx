"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { InvoiceListRow } from "@/lib/data/invoices";
import type { InvoiceStatus } from "@/lib/types";
import { formatAUD, formatDate } from "@/lib/format";
import {
  markPaidByIdAction,
  markUnpaidByIdAction,
  cancelInvoiceByIdAction,
  deleteInvoiceAction,
  type ActionState,
} from "../invoices/[id]/actions";

const STATUS_STYLES: Record<InvoiceStatus, string> = {
  unpaid: "bg-amber-100 text-amber-700",
  partial: "bg-blue-100 text-blue-700",
  paid: "bg-green-100 text-green-700",
  cancelled: "bg-slate-200 text-slate-500",
};

const today = new Date().toISOString().slice(0, 10);

function isOverdue(inv: InvoiceListRow) {
  return (
    (inv.status === "unpaid" || inv.status === "partial") &&
    inv.due_date < today
  );
}

function serviceDates(inv: InvoiceListRow) {
  const dates = inv.invoice_items
    .map((i) => i.service_date)
    .filter((d): d is string => !!d)
    .sort();
  if (dates.length === 0) return "—";
  const label = formatDate(dates[0]);
  const extra = new Set(dates).size - 1;
  return extra > 0 ? `${label} (+${extra})` : label;
}

export function HistoryTable({ invoices }: { invoices: InvoiceListRow[] }) {
  const [client, setClient] = useState("all");
  const [status, setStatus] = useState("all");
  const [abn, setAbn] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const clientNames = useMemo(
    () => Array.from(new Set(invoices.map((i) => i.bill_to_name))).sort(),
    [invoices],
  );

  const rows = invoices.filter((i) => {
    if (client !== "all" && i.bill_to_name !== client) return false;
    if (status !== "all" && i.status !== status) return false;
    if (abn !== "all" && i.issuer?.short_name !== abn) return false;
    if (dateFrom && i.invoice_date < dateFrom) return false;
    if (dateTo && i.invoice_date > dateTo) return false;
    return true;
  });

  const totalOutstanding = rows
    .filter((i) => i.status === "unpaid" || i.status === "partial")
    .reduce((sum, i) => sum + Number(i.balance_due), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={client} onChange={setClient} label="Client">
          <option value="all">All clients</option>
          {clientNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
        <Select value={status} onChange={setStatus} label="Status">
          <option value="all">All statuses</option>
          <option value="unpaid">Unpaid</option>
          <option value="partial">Partial</option>
          <option value="paid">Paid</option>
          <option value="cancelled">Cancelled</option>
        </Select>
        <Select value={abn} onChange={setAbn} label="ABN">
          <option value="all">Both ABNs</option>
          <option value="Mavi">Mavi</option>
          <option value="Andres">Andres</option>
        </Select>

        <label className="flex items-center gap-2 text-sm text-slate-600">
          <span className="text-xs font-medium text-slate-500">From</span>
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <span className="text-xs font-medium text-slate-500">To</span>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
          />
        </label>
        {(dateFrom || dateTo) && (
          <button
            type="button"
            onClick={() => {
              setDateFrom("");
              setDateTo("");
            }}
            className="rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100"
          >
            Clear dates
          </button>
        )}

        <div className="ml-auto text-sm text-slate-600">
          Outstanding:{" "}
          <span className="font-semibold text-slate-900">
            {formatAUD(totalOutstanding)}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">No.</th>
              <th className="px-4 py-3 font-medium">ABN</th>
              <th className="px-4 py-3 font-medium">Client</th>
              <th className="px-4 py-3 font-medium">Suburb</th>
              <th className="px-4 py-3 font-medium">Invoice date</th>
              <th className="px-4 py-3 font-medium">Service date</th>
              <th className="px-4 py-3 font-medium">Due date</th>
              <th className="px-4 py-3 text-right font-medium">Total</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Notes</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-10 text-center text-slate-400">
                  No invoices yet. Create the first one with{" "}
                  <Link href="/invoices/new" className="underline">
                    New invoice
                  </Link>
                  .
                </td>
              </tr>
            )}
            {rows.map((inv) => {
              const overdue = isOverdue(inv);
              return (
                <tr
                  key={inv.id}
                  className={overdue ? "bg-red-50/60" : "hover:bg-slate-50"}
                >
                  <td className="px-4 py-3 font-medium text-slate-900">
                    <Link href={`/invoices/${inv.id}`} className="hover:underline">
                      {inv.invoice_number}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                      {inv.issuer?.short_name ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-900">{inv.bill_to_name}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {inv.bill_to_suburb ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatDate(inv.invoice_date)}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {serviceDates(inv)}
                  </td>
                  <td
                    className={`px-4 py-3 ${
                      overdue ? "font-medium text-red-600" : "text-slate-600"
                    }`}
                  >
                    {formatDate(inv.due_date)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-slate-900">
                    {formatAUD(Number(inv.total))}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[inv.status]}`}
                    >
                      {overdue ? "overdue" : inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <NoteCell note={inv.internal_notes} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <RowMenu inv={inv} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Note cell: truncated in-row, full text in a hover tooltip (fixed-positioned
 *  so the table's horizontal scroll never clips it). */
function NoteCell({ note }: { note: string | null }) {
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null,
  );
  const ref = useRef<HTMLSpanElement>(null);

  if (!note) return <span className="text-slate-400">—</span>;

  function show() {
    const r = ref.current?.getBoundingClientRect();
    if (r) setCoords({ top: r.bottom + 6, left: r.left });
  }

  return (
    <span
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={() => setCoords(null)}
      className="block max-w-[16rem] cursor-default truncate text-slate-500"
    >
      {note}
      {coords && (
        <span
          style={{ position: "fixed", top: coords.top, left: coords.left }}
          className="z-50 block max-w-sm whitespace-normal rounded-lg bg-slate-900 px-3 py-2 text-xs font-normal text-white shadow-lg"
        >
          {note}
        </span>
      )}
    </span>
  );
}

/** Per-row actions dropdown: mark paid/unpaid, edit, delete (with confirm). */
function RowMenu({ inv }: { inv: InvoiceListRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(
    null,
  );
  const [confirm, setConfirm] = useState<"cancel" | "delete" | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const canPaid = inv.status === "unpaid" || inv.status === "partial";
  const canUnpaid = inv.status === "paid" || inv.status === "partial";
  const canCancel = inv.status !== "cancelled";

  function openMenu() {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setCoords({ top: r.bottom + 4, right: window.innerWidth - r.right });
    setError(null);
    setOpen(true);
  }
  function close() {
    setOpen(false);
    setConfirm(null);
  }

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    function onMove() {
      close();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open]);

  function run(action: () => Promise<ActionState>) {
    setError(null);
    start(async () => {
      const res = await action();
      if (res.ok) {
        close();
        router.refresh();
      } else {
        setError(res.error ?? "Failed.");
        setConfirm(null);
      }
    });
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => (open ? close() : openMenu())}
        className="rounded-lg border border-slate-200 px-2.5 py-1 text-slate-500 hover:bg-slate-100"
        aria-label="Row actions"
      >
        ⋯
      </button>

      {open && coords && (
        <div
          ref={menuRef}
          style={{ position: "fixed", top: coords.top, right: coords.right }}
          className="z-50 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-left text-sm shadow-lg"
        >
          {confirm === null ? (
            <>
              {canPaid && (
                <MenuItem
                  disabled={pending}
                  onClick={() => run(() => markPaidByIdAction(inv.id))}
                >
                  Mark as paid
                </MenuItem>
              )}
              {canUnpaid && (
                <MenuItem
                  disabled={pending}
                  onClick={() => run(() => markUnpaidByIdAction(inv.id))}
                >
                  Mark as unpaid
                </MenuItem>
              )}
              <Link
                href={`/invoices/${inv.id}/edit`}
                className="block px-3 py-2 text-slate-700 hover:bg-slate-50"
              >
                Edit invoice
              </Link>
              {canCancel && (
                <MenuItem warn onClick={() => setConfirm("cancel")}>
                  Cancel invoice
                </MenuItem>
              )}
              <MenuItem danger onClick={() => setConfirm("delete")}>
                Delete invoice
              </MenuItem>
              {error && (
                <p className="px-3 py-1 text-xs text-red-600">{error}</p>
              )}
            </>
          ) : confirm === "cancel" ? (
            <div className="px-3 py-2">
              <p className="mb-2 text-xs text-amber-700">
                Cancel this invoice? It stays on record, marked cancelled.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => run(() => cancelInvoiceByIdAction(inv.id))}
                  disabled={pending}
                  className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-60"
                >
                  {pending ? "…" : "Yes, cancel"}
                </button>
                <button
                  onClick={() => setConfirm(null)}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                >
                  No
                </button>
              </div>
            </div>
          ) : (
            <div className="px-3 py-2">
              <p className="mb-2 text-xs text-red-600">
                Delete permanently? This cannot be undone.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => run(() => deleteInvoiceAction(inv.id))}
                  disabled={pending}
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
                >
                  {pending ? "…" : "Yes, delete"}
                </button>
                <button
                  onClick={() => setConfirm(null)}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                >
                  No
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function MenuItem({
  children,
  onClick,
  disabled,
  danger,
  warn,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  warn?: boolean;
}) {
  const tone = danger
    ? "text-red-600 hover:bg-red-50"
    : warn
      ? "text-amber-700 hover:bg-amber-50"
      : "text-slate-700 hover:bg-slate-50";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`block w-full px-3 py-2 text-left disabled:opacity-50 ${tone}`}
    >
      {children}
    </button>
  );
}

function Select({
  value,
  onChange,
  label,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-600">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
      >
        {children}
      </select>
    </label>
  );
}
