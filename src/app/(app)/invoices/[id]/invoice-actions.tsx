"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { InvoiceStatus } from "@/lib/types";
import {
  markPaidAction,
  markUnpaidAction,
  cancelInvoiceAction,
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
  const [paidState, paid, paidPending] = useActionState(markPaidAction, initial);
  const [unpaidState, unpaid, unpaidPending] = useActionState(
    markUnpaidAction,
    initial,
  );
  const [cancelState, cancel, cancelPending] = useActionState(
    cancelInvoiceAction,
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

      {(status === "paid" || status === "partial") && (
        <form action={unpaid}>
          <input type="hidden" name="id" value={id} />
          <button
            disabled={unpaidPending}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {unpaidPending ? "…" : "Mark as unpaid"}
          </button>
        </form>
      )}

      <Link
        href={`/invoices/${id}/edit`}
        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        Edit invoice
      </Link>

      {status !== "cancelled" && (
        <>
          {!confirmingCancel ? (
            <button
              onClick={() => setConfirmingCancel(true)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50"
            >
              Cancel invoice
            </button>
          ) : (
            <form action={cancel} className="flex items-center gap-2">
              <input type="hidden" name="id" value={id} />
              <span className="text-sm text-slate-500">Cancel this invoice?</span>
              <button
                disabled={cancelPending}
                className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
              >
                {cancelPending ? "…" : "Yes, cancel"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingCancel(false)}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
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
          className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
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
            className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            No
          </button>
        </div>
      )}

      {err && <span className="text-sm text-red-600">{err}</span>}
    </div>
  );
}
