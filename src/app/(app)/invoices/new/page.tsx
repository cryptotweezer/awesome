import { listClients } from "@/lib/data/clients";
import { listIssuers } from "@/lib/data/issuers";
import { getNextInvoiceNumber } from "@/lib/data/invoices";
import { InvoiceForm } from "./invoice-form";
import { createInvoiceAction } from "./actions";

export default async function NewInvoicePage() {
  const [clients, issuers, nextNumber] = await Promise.all([
    listClients(),
    listIssuers(),
    getNextInvoiceNumber(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            New invoice
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Pick a client — the ABN, service and rate autofill. Add extra lines
            if needed.
          </p>
        </div>
        {nextNumber != null && (
          <div className="rounded-xl bg-white px-4 py-2 text-right shadow-sm ring-1 ring-slate-200">
            <span className="block text-[10px] font-medium uppercase tracking-wide text-slate-500">
              Next invoice #
            </span>
            <span className="block text-lg font-bold tabular-nums text-slate-900">
              {nextNumber}
            </span>
          </div>
        )}
      </div>

      <InvoiceForm
        clients={clients}
        issuers={issuers}
        nextNumber={nextNumber}
        action={createInvoiceAction}
      />
    </div>
  );
}
