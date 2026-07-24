"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { InvoiceListRow } from "@/lib/data/invoices";
import type { InvoiceStatus } from "@/lib/types";
import { formatAUD, formatDate, todayInSydney } from "@/lib/format";
import {
  markPaidByIdAction,
  markUnpaidByIdAction,
  cancelInvoiceByIdAction,
  reactivateInvoiceByIdAction,
  deleteInvoiceAction,
  type ActionState,
} from "../invoices/[id]/actions";

const STATUS_STYLES: Record<InvoiceStatus, string> = {
  unpaid: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  paid: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  cancelled:
    "bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

const today = todayInSydney();

function isOverdue(inv: InvoiceListRow) {
  return inv.status === "unpaid" && inv.due_date < today;
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

/** Which table the filter bar acts on. The other one stays whole. */
type Scope = "outstanding" | "closed" | "both";

const SCOPE_STATUSES: Record<Scope, InvoiceStatus[]> = {
  outstanding: ["unpaid"],
  closed: ["paid", "cancelled"],
  both: ["unpaid", "paid", "cancelled"],
};

export function HistoryTable({ invoices }: { invoices: InvoiceListRow[] }) {
  const [scope, setScope] = useState<Scope>("both");
  const [client, setClient] = useState("all");
  const [status, setStatus] = useState("all");
  const [abn, setAbn] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const clientNames = useMemo(
    () => Array.from(new Set(invoices.map((i) => i.bill_to_name))).sort(),
    [invoices],
  );

  function matches(i: InvoiceListRow) {
    if (client !== "all" && i.bill_to_name !== client) return false;
    if (status !== "all" && i.status !== status) return false;
    if (abn !== "all" && i.issuer?.short_name !== abn) return false;
    if (dateFrom && i.invoice_date < dateFrom) return false;
    if (dateTo && i.invoice_date > dateTo) return false;
    return true;
  }

  /** A status that no longer exists in the new scope would blank the table. */
  function changeScope(next: Scope) {
    setScope(next);
    if (
      status !== "all" &&
      !SCOPE_STATUSES[next].includes(status as InvoiceStatus)
    ) {
      setStatus("all");
    }
  }

  const filtered =
    client !== "all" ||
    status !== "all" ||
    abn !== "all" ||
    Boolean(dateFrom) ||
    Boolean(dateTo);

  // Two buckets so the page doesn't become one endless list: what still needs
  // chasing on top (always fully visible), everything settled below (scrolls).
  const allOutstanding = invoices.filter((i) => i.status === "unpaid");
  // Closed invoices are an archive that only grows — newest first, otherwise
  // the most recent one would always sit at the bottom of the scroll box.
  const allClosed = invoices
    .filter((i) => i.status === "paid" || i.status === "cancelled")
    .slice()
    .reverse();

  const inScope = (s: Scope) => scope === s || scope === "both";
  const outstanding = inScope("outstanding")
    ? allOutstanding.filter(matches)
    : allOutstanding;
  const closed = inScope("closed") ? allClosed.filter(matches) : allClosed;

  const totalOutstanding = outstanding.reduce(
    (sum, i) => sum + Number(i.balance_due),
    0,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Filter
        </span>
        <div className="flex rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5">
          <ScopeTab
            active={scope === "outstanding"}
            onClick={() => changeScope("outstanding")}
          >
            To be paid
          </ScopeTab>
          <ScopeTab
            active={scope === "closed"}
            onClick={() => changeScope("closed")}
          >
            Paid &amp; cancelled
          </ScopeTab>
          <ScopeTab
            active={scope === "both"}
            onClick={() => changeScope("both")}
          >
            Both
          </ScopeTab>
        </div>
      </div>

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
          {SCOPE_STATUSES[scope].map((st) => (
            <option key={st} value={st}>
              {st[0].toUpperCase() + st.slice(1)}
            </option>
          ))}
        </Select>
        <Select value={abn} onChange={setAbn} label="ABN">
          <option value="all">Both ABNs</option>
          <option value="Mavi">Mavi</option>
          <option value="Andres">Andres</option>
        </Select>

        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            From
          </span>
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            To
          </span>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100"
          />
        </label>
        {(dateFrom || dateTo) && (
          <button
            type="button"
            onClick={() => {
              setDateFrom("");
              setDateTo("");
            }}
            className="rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Clear dates
          </button>
        )}

        <div className="ml-auto text-sm text-slate-600 dark:text-slate-400">
          Outstanding:{" "}
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            {formatAUD(totalOutstanding)}
          </span>
        </div>
      </div>

      <InvoiceTable
        title="To be paid"
        rows={outstanding}
        filtered={filtered && inScope("outstanding")}
        empty={
          invoices.length === 0 ? (
            <>
              No invoices yet. Create the first one with{" "}
              <Link href="/invoices/new" className="underline">
                New invoice
              </Link>
              .
            </>
          ) : filtered && inScope("outstanding") ? (
            "No invoices match these filters."
          ) : (
            "🎉 Nothing to chase — everything is paid."
          )
        }
      />

      <InvoiceTable
        title="Paid & cancelled"
        rows={closed}
        scrollable
        filtered={filtered && inScope("closed")}
        empty={
          filtered && inScope("closed")
            ? "No invoices match these filters."
            : "Nothing settled yet."
        }
      />
    </div>
  );
}

function ScopeTab({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1 text-xs font-medium transition ${
        active
          ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100"
          : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

/** Rows in the closed bucket before it stops growing and scrolls internally. */
const CLOSED_MAX_HEIGHT = "28rem"; // ≈ 10 rows + header

function InvoiceTable({
  title,
  rows,
  empty,
  scrollable = false,
  filtered = false,
}: {
  title: string;
  rows: InvoiceListRow[];
  empty: React.ReactNode;
  scrollable?: boolean;
  /** Marks the table the filter bar is currently acting on. */
  filtered?: boolean;
}) {
  const total = rows.reduce((sum, i) => sum + Number(i.total), 0);

  return (
    <div className="rounded-2xl bg-white dark:bg-slate-900 shadow-sm ring-1 ring-slate-200 dark:ring-slate-800">
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            {title}
          </h2>
          {filtered && (
            <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              filtered
            </span>
          )}
        </div>
        <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
          {rows.length} {rows.length === 1 ? "invoice" : "invoices"} ·{" "}
          {formatAUD(total)}
        </span>
      </div>

      <div
        className="overflow-x-auto"
        style={
          scrollable
            ? { maxHeight: CLOSED_MAX_HEIGHT, overflowY: "auto" }
            : undefined
        }
      >
        <table className="w-full text-left text-sm">
          <thead
            className={`border-b border-slate-200 dark:border-slate-800 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 ${
              scrollable ? "sticky top-0 z-10 bg-white dark:bg-slate-900" : ""
            }`}
          >
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
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={11}
                  className="px-4 py-10 text-center text-slate-400 dark:text-slate-500"
                >
                  {empty}
                </td>
              </tr>
            )}
            {rows.map((inv) => {
              const overdue = isOverdue(inv);
              return (
                <tr
                  key={inv.id}
                  className={
                    overdue
                      ? "bg-red-50/60 dark:bg-red-950/25"
                      : "hover:bg-slate-50 dark:hover:bg-slate-800"
                  }
                >
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                    <Link
                      href={`/invoices/${inv.id}`}
                      className="hover:underline"
                    >
                      {inv.invoice_number}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-700 dark:text-slate-300">
                      {inv.issuer?.short_name ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-900 dark:text-slate-100">
                    {inv.bill_to_name}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                    {inv.bill_to_suburb ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                    {formatDate(inv.invoice_date)}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                    {serviceDates(inv)}
                  </td>
                  <td
                    className={`px-4 py-3 ${
                      overdue
                        ? "font-medium text-red-600 dark:text-red-400"
                        : "text-slate-600 dark:text-slate-400"
                    }`}
                  >
                    {formatDate(inv.due_date)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-slate-900 dark:text-slate-100">
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

  if (!note)
    return <span className="text-slate-400 dark:text-slate-500">—</span>;

  function show() {
    const r = ref.current?.getBoundingClientRect();
    if (r) setCoords({ top: r.bottom + 6, left: r.left });
  }

  return (
    <span
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={() => setCoords(null)}
      className="block max-w-[16rem] cursor-default truncate text-slate-500 dark:text-slate-400"
    >
      {note}
      {coords && (
        <span
          style={{ position: "fixed", top: coords.top, left: coords.left }}
          className="z-50 block max-w-sm whitespace-normal rounded-lg bg-slate-900 px-3 py-2 text-xs font-normal text-white dark:bg-slate-800 dark:text-slate-100 shadow-lg"
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

  const cancelled = inv.status === "cancelled";
  const canPaid = inv.status === "unpaid";
  const canUnpaid = inv.status === "paid";
  const canCancel = !cancelled;

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
        className="rounded-lg border border-slate-200 dark:border-slate-800 px-2.5 py-1 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
        aria-label="Row actions"
      >
        ⋯
      </button>

      {open && coords && (
        <div
          ref={menuRef}
          style={{ position: "fixed", top: coords.top, right: coords.right }}
          className="z-50 w-48 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 py-1 text-left text-sm shadow-lg"
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
                className="block px-3 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Edit invoice
              </Link>
              {canCancel && (
                <MenuItem warn onClick={() => setConfirm("cancel")}>
                  Cancel invoice
                </MenuItem>
              )}
              {cancelled && (
                <MenuItem
                  disabled={pending}
                  onClick={() => run(() => reactivateInvoiceByIdAction(inv.id))}
                >
                  Reactivate invoice
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
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
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
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
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
    ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/50"
    : warn
      ? "text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/50"
      : "text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800";
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
    <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100"
      >
        {children}
      </select>
    </label>
  );
}
