import { listClients } from "@/lib/data/clients";
import { listIssuers } from "@/lib/data/issuers";
import { requireOrg } from "@/lib/data/org";
import { ClientsManager } from "./clients-manager";

export default async function ClientsPage() {
  const { org } = await requireOrg();
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
            Complete client list
          </p>
        </div>
        <div className="rounded-2xl bg-white dark:bg-slate-900 px-5 py-3 text-right shadow-sm ring-1 ring-slate-200 dark:ring-slate-800">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Clients
          </p>
          <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            {clients.length}
          </p>
        </div>
      </div>

      <ClientsManager clients={clients} issuers={issuers} />
    </div>
  );
}
