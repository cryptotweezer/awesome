import { listClients } from "@/lib/data/clients";
import { listIssuers } from "@/lib/data/issuers";
import { awesomeForPage } from "@/lib/data/org";
import { ClientsManager } from "@/app/(app)/clients/clients-manager";

/**
 * The complete client list, invoiced and cash alike.
 *
 * This is the same component the billing dashboard uses, with one prop turned
 * on. Forking it would mean two client forms to keep in step, and the first
 * thing to drift would be the part that decides whether somebody gets billed.
 */
export default async function SavingsClientsPage() {
  const org = await awesomeForPage();
  const [clients, issuers] = await Promise.all([
    listClients(org.id),
    listIssuers(org.id),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Clients
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Everyone you work for, billed or not
          </p>
        </div>
        {/* Each list carries its own count, so the only number worth a card up
            here is the one neither of them shows. */}
        <Stat label="Clients" value={clients.length} />
      </div>

      <ClientsManager
        clients={clients}
        issuers={issuers}
        perClientDefaults={org.per_client_defaults}
        defaultDescription={org.default_service_description ?? ""}
        savings
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-white px-5 py-3 text-right shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
        {value}
      </p>
    </div>
  );
}
