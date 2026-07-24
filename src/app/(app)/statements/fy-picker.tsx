"use client";

import { useState } from "react";
import type { FinancialYearOption } from "@/lib/data/statements";
import type { Issuer } from "@/lib/types";

/**
 * Picks the ABN + Australian financial year for the accountant's statement.
 * Each ABN is a separate legal entity, so it always gets its own document.
 */
export function FyStatementPicker({
  issuers,
  years,
}: {
  issuers: Pick<Issuer, "id" | "short_name" | "abn">[];
  years: FinancialYearOption[];
}) {
  const [issuerId, setIssuerId] = useState(issuers[0]?.id ?? "");
  const [fy, setFy] = useState(years[0]?.start ?? "");
  const href = issuerId ? `/statements/fy/${issuerId}/pdf?fy=${fy}` : "";

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
          ABN
        </span>
        <select
          value={issuerId}
          onChange={(e) => setIssuerId(e.target.value)}
          className="min-w-[13rem] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
        >
          {issuers.map((i) => (
            <option key={i.id} value={i.id}>
              {i.short_name} — {i.abn}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Financial year
        </span>
        <select
          value={fy}
          onChange={(e) => setFy(e.target.value)}
          className="min-w-[13rem] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
        >
          {years.map((y) => (
            <option key={y.start} value={y.start}>
              {y.label} · {y.invoiceCount}{" "}
              {y.invoiceCount === 1 ? "invoice" : "invoices"}
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
        href={`${href}&inline=1`}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 transition hover:bg-slate-50 dark:hover:bg-slate-800"
      >
        Preview
      </a>
    </div>
  );
}
