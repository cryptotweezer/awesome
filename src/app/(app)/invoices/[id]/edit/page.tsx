import Link from "next/link";
import { notFound } from "next/navigation";
import { listClients } from "@/lib/data/clients";
import { listIssuers } from "@/lib/data/issuers";
import { getInvoice } from "@/lib/data/invoices";
import { orgForPage } from "@/lib/data/org";
import { todayInTimezone } from "@/lib/format";
import { InvoiceForm } from "../../new/invoice-form";
import { updateInvoiceAction } from "../actions";

export default async function EditInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const org = await orgForPage();
  const [inv, clients, issuers] = await Promise.all([
    getInvoice(org.id, id),
    listClients(org.id),
    listIssuers(org.id),
  ]);
  if (!inv) notFound();

  const initial = {
    client_id: inv.client_id ?? "",
    issuer_id: inv.issuer_id ?? "",
    invoice_date: inv.invoice_date,
    internal_notes: inv.internal_notes ?? "",
    lines: inv.invoice_items.map((it) => ({
      description: it.description,
      service_date: it.service_date ?? "",
      quantity: String(Number(it.quantity)),
      rate: String(Number(it.rate)),
    })),
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href={`/invoices/${id}`}
          className="text-sm text-slate-500 dark:text-slate-400 hover:underline"
        >
          ← Back to invoice
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Edit invoice #{inv.invoice_number}
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Fix any detail: the invoice number stays the same. Totals and due
          date recalculate on save.
        </p>
      </div>

      <InvoiceForm
        clients={clients}
        issuers={issuers}
        today={todayInTimezone(org.timezone)}
        termsDays={org.terms_days}
        // The invoice's own rate, not the business's current one: editing an
        // invoice never changes the tax it was issued under.
        gstRate={Number(inv.gst_rate ?? 0)}
        defaultDescription={org.default_service_description ?? ""}
        initial={initial}
        submitLabel="Save changes"
        action={updateInvoiceAction.bind(null, id)}
      />
    </div>
  );
}
