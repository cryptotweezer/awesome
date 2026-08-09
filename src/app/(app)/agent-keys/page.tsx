import { listAgentKeys } from "@/lib/data/agent-keys";
import { requireOrg } from "@/lib/data/org";
import { KeysManager } from "./keys-manager";

export default async function AgentKeysPage() {
  const { org } = await requireOrg();
  const keys = await listAgentKeys(org.id);
  const active = keys.filter((k) => k.is_active).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Agent Keys
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            API keys AI agents use to reach the billing gateway
          </p>
        </div>
        <div className="rounded-2xl bg-white dark:bg-slate-900 px-5 py-3 text-right shadow-sm ring-1 ring-slate-200 dark:ring-slate-800">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Active
          </p>
          <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            {active}
          </p>
        </div>
      </div>

      <KeysManager keys={keys} />
    </div>
  );
}
