"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { InvoiceStatus } from "@/lib/types";
import {
  markPaidAction,
  markUnpaidAction,
  cancelInvoiceAction,
  reactivateInvoiceAction,
  deleteInvoiceAction,
  type ActionState,
} from "./actions";

const initial: ActionState = { ok: false };

export function InvoiceActions({
  id,
  status,
}: {
  id: string;
  status: InvoiceStatus;
}) {
  const router = useRouter();
  const [paidState, paid, paidPending] = useActionState(
    markPaidAction,
    initial,
  );
  const [unpaidState, unpaid, unpaidPending] = useActionState(
    markUnpaidAction,
    initial,
  );
  const [cancelState, cancel, cancelPending] = useActionState(
    cancelInvoiceAction,
    initial,
  );
  const [reactivateState, reactivate, reactivatePending] = useActionState(
    reactivateInvoiceAction,
    initial,
  );
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletePending, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const err =
    paidState.error ||
    unpaidState.error ||
    cancelState.error ||
    reactivateState.error ||
    deleteError;

  function onDelete() {
    setDeleteError(null);
    startDelete(async () => {
      const res = await deleteInvoiceAction(id);
      if (res.ok) {
        router.push("/history");
        router.refresh();
      } else {
        setDeleteError(res.error ?? "Failed to delete.");
        setConfirmingDelete(false);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status !== "paid" && status !== "cancelled" && (
        <form action={paid}>
          <input type="hidden" name="id" value={id} />
          <button
            disabled={paidPending}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60"
          >
            {paidPending ? "…" : "Mark as paid"}
          </button>
        </form>
      )}

      {status === "paid" && (
        <form action={unpaid}>
          <input type="hidden" name="id" value={id} />
          <button
            disabled={unpaidPending}
            className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
          >
            {unpaidPending ? "…" : "Mark as unpaid"}
          </button>
        </form>
      )}

      {/* Rendered on demand by /invoices/[id]/pdf — nothing is stored. */}
      <a
        href={`/invoices/${id}/pdf`}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
      >
        Download PDF
      </a>

      <a
        href={`/invoices/${id}/pdf?inline=1`}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
      >
        Print
      </a>

      <Link
        href={`/invoices/${id}/edit`}
        className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
      >
        Edit invoice
      </Link>

      {/* Undo a cancellation done by mistake — the status re-derives itself. */}
      {status === "cancelled" && (
        <form action={reactivate}>
          <input type="hidden" name="id" value={id} />
          <button
            disabled={reactivatePending}
            className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
          >
            {reactivatePending ? "…" : "Reactivate invoice"}
          </button>
        </form>
      )}

      {status !== "cancelled" && (
        <>
          {!confirmingCancel ? (
            <button
              onClick={() => setConfirmingCancel(true)}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50"
            >
              Cancel invoice
            </button>
          ) : (
            <form action={cancel} className="flex items-center gap-2">
              <input type="hidden" name="id" value={id} />
              <span className="text-sm text-slate-500 dark:text-slate-400">
                Cancel this invoice?
              </span>
              <button
                disabled={cancelPending}
                className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
              >
                {cancelPending ? "…" : "Yes, cancel"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingCancel(false)}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                No
              </button>
            </form>
          )}
        </>
      )}

      {/* Delete = hard delete, always confirmed */}
      {!confirmingDelete ? (
        <button
          onClick={() => setConfirmingDelete(true)}
          className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/50"
        >
          Delete invoice
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-sm text-red-600">
            Delete permanently? This cannot be undone.
          </span>
          <button
            type="button"
            onClick={onDelete}
            disabled={deletePending}
            className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
          >
            {deletePending ? "…" : "Yes, delete"}
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDelete(false)}
            className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            No
          </button>
        </div>
      )}

      {err && <span className="text-sm text-red-600">{err}</span>}
    </div>
  );
}
