import Link from "next/link";
import { notFound } from "next/navigation";
import { getInvoice } from "@/lib/data/invoices";
import { orgForPage } from "@/lib/data/org";
import { formatAUD, formatDate } from "@/lib/format";
import { InvoiceActions } from "./invoice-actions";

const STATUS_STYLES: Record<string, string> = {
  unpaid: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  paid: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  cancelled:
    "bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const org = await orgForPage();
  const inv = await getInvoice(org.id, id);
  if (!inv) notFound();

  const billTo = [
    inv.bill_to_address_line,
    inv.bill_to_suburb,
    [inv.bill_to_state, inv.bill_to_postcode].filter(Boolean).join(" "),
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/history"
          className="text-sm text-slate-500 dark:text-slate-400 hover:underline"
        >
          ← Back to history
        </Link>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLES[inv.status]}`}
        >
          {inv.status}
        </span>
      </div>

      <div className="rounded-2xl bg-white dark:bg-slate-900 p-8 shadow-sm ring-1 ring-slate-200 dark:ring-slate-800">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Invoice #{inv.invoice_number}
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {inv.issuer_name} · ABN {inv.issuer_abn}
            </p>
          </div>
          <div className="text-right text-sm">
            <p className="text-slate-500 dark:text-slate-400">
              Date:{" "}
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {formatDate(inv.invoice_date)}
              </span>
            </p>
            <p className="text-slate-500 dark:text-slate-400">
              Terms:{" "}
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {inv.terms}
              </span>
            </p>
            <p className="text-slate-500 dark:text-slate-400">
              Due:{" "}
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {formatDate(inv.due_date)}
              </span>
            </p>
          </div>
        </div>

        <div className="mt-6 border-t border-slate-100 dark:border-slate-800 pt-6">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Bill to
          </p>
          <p className="mt-1 font-medium text-slate-900 dark:text-slate-100">
            {inv.bill_to_name}
          </p>
          {billTo.map((line, i) => (
            <p key={i} className="text-sm text-slate-600 dark:text-slate-400">
              {line}
            </p>
          ))}
        </div>

        {/* Line items */}
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 dark:border-slate-800 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <tr>
                <th className="py-2 font-medium">Description</th>
                <th className="py-2 font-medium">Service date</th>
                <th className="py-2 text-right font-medium">Qty</th>
                <th className="py-2 text-right font-medium">Rate</th>
                <th className="py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {inv.invoice_items.map((it) => (
                <tr key={it.id}>
                  <td className="py-2 text-slate-900 dark:text-slate-100">
                    {it.description}
                  </td>
                  <td className="py-2 text-slate-600 dark:text-slate-400">
                    {formatDate(it.service_date)}
                  </td>
                  <td className="py-2 text-right text-slate-600 dark:text-slate-400">
                    {Number(it.quantity)}
                  </td>
                  <td className="py-2 text-right text-slate-600 dark:text-slate-400">
                    {formatAUD(Number(it.rate))}
                  </td>
                  <td className="py-2 text-right font-medium text-slate-900 dark:text-slate-100">
                    {formatAUD(Number(it.amount))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="mt-6 flex justify-end">
          <div className="w-full max-w-xs space-y-1 text-sm">
            {/* Only when this invoice was issued with GST inside it. The rate
                is the invoice's own, not the business's current one. */}
            {Number(inv.gst_amount) > 0 && (
              <>
                <Row
                  label="Subtotal"
                  value={formatAUD(Number(inv.total) - Number(inv.gst_amount))}
                />
                <Row
                  label={`GST (${(Number(inv.gst_rate) * 100).toFixed(0)}%)`}
                  value={formatAUD(Number(inv.gst_amount))}
                />
              </>
            )}
            <Row label="Total" value={formatAUD(Number(inv.total))} />
            <Row label="Paid" value={formatAUD(Number(inv.paid_amount))} />
            <div className="flex justify-between border-t border-slate-200 dark:border-slate-800 pt-2 text-base font-bold text-slate-900 dark:text-slate-100">
              <span>Balance due</span>
              <span>{formatAUD(Number(inv.balance_due))}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Internal-only block */}
      <div className="rounded-2xl bg-slate-50 dark:bg-slate-900 p-6 ring-1 ring-slate-200 dark:ring-slate-800">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
          Internal (not printed)
        </p>
        <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          <p className="text-slate-600 dark:text-slate-400">
            Created by:{" "}
            <span className="font-medium text-slate-900 dark:text-slate-100">
              {inv.created_by ?? "-"}
            </span>
          </p>
          <p className="text-slate-600 dark:text-slate-400">
            Notes:{" "}
            <span className="font-medium text-slate-900 dark:text-slate-100">
              {inv.internal_notes ?? "-"}
            </span>
          </p>
        </div>
      </div>

      <InvoiceActions id={inv.id} status={inv.status} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-slate-600 dark:text-slate-400">
      <span>{label}</span>
      <span className="font-medium text-slate-900 dark:text-slate-100">
        {value}
      </span>
    </div>
  );
}
