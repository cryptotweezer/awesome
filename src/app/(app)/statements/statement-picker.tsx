"use client";

import { useState } from "react";
import type { StatementTarget } from "@/lib/data/statements";
import { formatAUD } from "@/lib/format";

/**
 * Picks the client whose outstanding statement to print. Covers every unpaid
 * invoice they hold regardless of ABN — it is a reminder, not a tax document.
 */
export function ClientStatementPicker({
  targets,
}: {
  targets: StatementTarget[];
}) {
  const [clientId, setClientId] = useState(
    targets.length > 0 ? targets[0].client_id : "",
  );
  const href = clientId ? `/statements/client/${clientId}/pdf` : "";

  if (targets.length === 0) {
    return (
      <p className="text-sm text-slate-400 dark:text-slate-500">
        🎉 Nothing outstanding, there is no one to remind.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Client
        </span>
        <select
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="min-w-[22rem] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
        >
          {targets.map((t) => (
            <option key={t.client_id} value={t.client_id}>
              {t.client_name} · {t.invoiceCount}{" "}
              {t.invoiceCount === 1 ? "invoice" : "invoices"} ·{" "}
              {formatAUD(t.amount)}
              {t.overdueCount > 0 ? ` · ${t.overdueCount} overdue` : ""}
            </option>
          ))}
        </select>
      </label>

      <a
        href={href}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
      >
        Download PDF
      </a>
      <a
        href={`${href}?inline=1`}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 transition hover:bg-slate-50 dark:hover:bg-slate-800"
      >
        Preview
      </a>
    </div>
  );
}
