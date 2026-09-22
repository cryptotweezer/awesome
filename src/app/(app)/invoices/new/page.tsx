import { listClients } from "@/lib/data/clients";
import { listIssuers } from "@/lib/data/issuers";
import { getNextInvoiceNumber } from "@/lib/data/invoices";
import { orgForPage } from "@/lib/data/org";
import { todayInTimezone } from "@/lib/format";
import { InvoiceForm, type InvoiceFormInitial } from "./invoice-form";
import { createInvoiceAction } from "./actions";
import type { ClientWithIssuer, Issuer } from "@/lib/types";

/** One query-string value, however the router hands it over. */
function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/**
 * The invoice a caller asked for, or nothing.
 *
 * The client has to be one this business can bill: the id arrives in a URL, so
 * it is looked up in the list rather than trusted. The extra comes as a second
 * line with its own note, because that is what it is on a printed invoice, and
 * both lines carry the same service date.
 */
function prefill(
  params: Record<string, string | string[] | undefined>,
  clients: ClientWithIssuer[],
  issuers: Issuer[],
  today: string,
  defaultDescription: string | null,
): InvoiceFormInitial | null {
  const clientId = one(params.client);
  if (!clientId) return null;
  const client = clients.find((c) => c.id === clientId);
  if (!client) return null;

  const serviceDate = /^\d{4}-\d{2}-\d{2}$/.test(one(params.service_date))
    ? one(params.service_date)
    : "";
  const description =
    client.default_description || defaultDescription || "";
  const amount = Number(one(params.amount));
  const extra = Number(one(params.extra));

  const lines = [
    {
      description,
      service_date: serviceDate,
      quantity: "1",
      rate: Number.isFinite(amount) && amount > 0
        ? String(amount)
        : client.default_rate != null
          ? String(client.default_rate)
          : "",
    },
  ];
  if (Number.isFinite(extra) && extra > 0) {
    lines.push({
      description: one(params.extra_note) || "Extra work",
      service_date: serviceDate,
      quantity: "1",
      rate: String(extra),
    });
  }

  return {
    client_id: client.id,
    // Blank is not an option here: an empty string is not nullish, so the
    // form's own fallbacks would never run.
    issuer_id:
      client.default_issuer_id ??
      (issuers.length === 1 ? issuers[0].id : ""),
    invoice_date: today,
    internal_notes: "",
    lines,
  };
}

/**
 * A new invoice, optionally already filled in by whoever sent us here.
 *
 * The savings week links here with the client, the day the work was really done
 * and what it came to, so the invoice comes back carrying the service date that
 * week matches on. It is a prefill and nothing more: every field is still
 * editable and nothing is saved until Create is pressed.
 */
export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const org = await orgForPage();
  const [clients, issuers, nextNumber] = await Promise.all([
    listClients(org.id, { invoiceable: true }),
    listIssuers(org.id),
    getNextInvoiceNumber(org.id),
  ]);

  // Archived clients are not offered: archiving exists precisely so that
  // somebody the business no longer deals with stops appearing here. Their
  // invoices are untouched.
  const billable = clients.filter((c) => c.is_active);

  const today = todayInTimezone(org.timezone);
  const initial = prefill(
    params,
    billable,
    issuers,
    today,
    org.default_service_description,
  );

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
        today={today}
        termsDays={org.terms_days}
        gstRate={org.gst_registered ? 0.1 : 0}
        defaultDescription={org.default_service_description ?? ""}
        action={createInvoiceAction}
        initial={initial}
        editing={false}
      />
    </div>
  );
}
