import { listClients } from "@/lib/data/clients";
import { listIssuers } from "@/lib/data/issuers";
import { getNextInvoiceNumber } from "@/lib/data/invoices";
import { orgForPage } from "@/lib/data/org";
import { todayInTimezone } from "@/lib/format";
import { InvoiceForm } from "./invoice-form";
import { createInvoiceAction } from "./actions";

export default async function NewInvoicePage() {
  const org = await orgForPage();
  const [clients, issuers, nextNumber] = await Promise.all([
    listClients(org.id),
    listIssuers(org.id),
    getNextInvoiceNumber(org.id),
  ]);

  // Archived clients are not offered: archiving exists precisely so that
  // somebody the business no longer deals with stops appearing here. Their
  // invoices are untouched.
  const billable = clients.filter((c) => c.is_active);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            New invoice
          </h1>
          {nextNumber != null && (
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              This invoice will be #{nextNumber}. The final number is assigned
              when you save.
            </p>
          )}
        </div>
        {nextNumber != null && (
          <div className="rounded-xl bg-white dark:bg-slate-900 px-4 py-2 text-right shadow-sm ring-1 ring-slate-200 dark:ring-slate-800">
            <span className="block text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Next invoice #
            </span>
            <span className="block text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {nextNumber}
            </span>
          </div>
        )}
      </div>

      <InvoiceForm
        clients={billable}
        issuers={issuers}
        today={todayInTimezone(org.timezone)}
        termsDays={org.terms_days}
        gstRate={org.gst_registered ? 0.1 : 0}
        defaultDescription={org.default_service_description ?? ""}
        action={createInvoiceAction}
      />
    </div>
  );
}
