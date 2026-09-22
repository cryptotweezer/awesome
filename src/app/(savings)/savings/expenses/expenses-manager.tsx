"use client";

import { useActionState, useEffect, useState } from "react";
import type { ExpenseCategory, ExpenseItem } from "@/lib/types";
import { EXPENSE_CATEGORIES, aud } from "@/lib/savings";
import {
  saveExpenseAction,
  setExpenseActiveAction,
  deleteExpenseAction,
  type ActionState,
} from "./actions";

const initial: ActionState = { ok: false };

export function ExpensesManager({ items }: { items: ExpenseItem[] }) {
  // null = closed; "new" = add; otherwise the item being edited.
  const [editing, setEditing] = useState<ExpenseItem | "new" | null>(null);

  const archived = items.filter((i) => !i.is_active);

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          onClick={() => setEditing("new")}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          + Add expense
        </button>
      </div>

      {/* One block per commitment, side by side. A flat list would total to the
          same number and answer none of the questions the split exists for. */}
      <div className="grid gap-4 lg:grid-cols-3">
        {EXPENSE_CATEGORIES.map((c) => {
          const rows = items.filter(
            (i) => i.category === c.value && i.is_active,
          );
          const total = rows.reduce((sum, i) => sum + i.weekly_amount, 0);
          return (
            <section key={c.value} className="space-y-2">
              <div className="flex items-baseline justify-between gap-3 px-1">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {c.label}
                </h2>
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {aud(total)}
                </span>
              </div>
              <Table
                rows={rows}
                empty="Nothing here yet."
                onEdit={setEditing}
              />
            </section>
          );
        })}
      </div>

      {archived.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-baseline gap-3">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Archived
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Not counted in a week. Restore one and it starts counting again.
            </p>
          </div>
          <Table rows={archived} empty="" onEdit={setEditing} showCategory />
        </section>
      )}

      {editing !== null && (
        <ExpenseDialog
          item={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function Table({
  rows,
  empty,
  onEdit,
  showCategory = false,
}: {
  rows: ExpenseItem[];
  empty: string;
  onEdit: (item: ExpenseItem) => void;
  showCategory?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
          <tr>
            <th className="px-4 py-3 font-medium">Expense</th>
            {showCategory && <th className="px-4 py-3 font-medium">Where</th>}
            <th className="px-4 py-3 text-right font-medium">Per week</th>
            <th className="px-4 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={showCategory ? 4 : 3}
                className="px-4 py-8 text-center text-slate-400 dark:text-slate-500"
              >
                {empty}
              </td>
            </tr>
          )}
          {rows.map((i) => (
            <tr key={i.id} className="hover:bg-slate-50 dark:hover:bg-slate-800">
              <td
                className={`px-4 py-3 font-medium ${
                  i.is_active
                    ? "text-slate-900 dark:text-slate-100"
                    : "text-slate-400 dark:text-slate-500"
                }`}
              >
                {i.name}
              </td>
              {showCategory && (
                <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                  {EXPENSE_CATEGORIES.find((c) => c.value === i.category)
                    ?.label ?? i.category}
                </td>
              )}
              <td className="px-4 py-3 text-right font-medium text-slate-900 dark:text-slate-100">
                {aud(i.weekly_amount)}
              </td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-1">
                  <button
                    onClick={() => onEdit(i)}
                    className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                  >
                    Edit
                  </button>
                  <ArchiveButton id={i.id} active={i.is_active} />
                  <DeleteButton id={i.id} name={i.name} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExpenseDialog({
  item,
  onClose,
}: {
  item: ExpenseItem | null;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(saveExpenseAction, initial);
  const [category, setCategory] = useState<ExpenseCategory>(
    item?.category ?? "australia",
  );

  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {item ? "Edit expense" : "Add expense"}
        </h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          What this normally costs in a week. A week that came in higher or
          lower is recorded on that week, and this number stays as it is.
        </p>

        <form action={action} className="mt-4 space-y-4">
          {item && <input type="hidden" name="id" value={item.id} />}

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
              Name <span className="text-red-500">*</span>
            </span>
            <input
              name="name"
              required
              autoFocus
              defaultValue={item?.name ?? ""}
              className="input"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Where <span className="text-red-500">*</span>
              </span>
              <select
                name="category"
                value={category}
                onChange={(e) =>
                  setCategory(e.target.value as ExpenseCategory)
                }
                className="input"
              >
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
                Per week (AUD) <span className="text-red-500">*</span>
              </span>
              <input
                name="weekly_amount"
                type="number"
                step="0.01"
                min="0"
                required
                defaultValue={item?.weekly_amount ?? ""}
                className="input"
              />
            </label>
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
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * An expense that has stopped applying is archived rather than deleted: it
 * leaves the weekly total and keeps whatever history it is part of.
 */
function ArchiveButton({ id, active }: { id: string; active: boolean }) {
  const [state, action, pending] = useActionState(
    setExpenseActiveAction,
    initial,
  );

  return (
    <form action={action} className="flex items-center gap-1">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={active ? "false" : "true"} />
      <button
        type="submit"
        disabled={pending}
        title={
          active
            ? "Stop counting this in a week. Nothing is lost."
            : "Count this again."
        }
        className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60 dark:text-slate-400 dark:hover:bg-slate-800"
      >
        {pending ? "…" : active ? "Archive" : "Restore"}
      </button>
      {state.error && (
        <span className="text-xs text-red-600 dark:text-red-400">
          {state.error}
        </span>
      )}
    </form>
  );
}

function DeleteButton({ id, name }: { id: string; name: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(deleteExpenseAction, initial);

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
          className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          No
        </button>
      </form>
      {state.error && (
        <p className="max-w-xs rounded-lg bg-red-50 px-3 py-2 text-left text-xs text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900">
          {state.error}
        </p>
      )}
    </div>
  );
}
