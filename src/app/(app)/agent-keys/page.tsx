import { listAgentKeys } from "@/lib/data/agent-keys";
import { orgForPage } from "@/lib/data/org";
import { listConnections } from "@/lib/oauth/store";
import { appBaseUrl } from "@/lib/app-url";
import { KeysManager } from "./keys-manager";
import { Connections } from "./connections";
import { ConnectCommand } from "./connect-command";
import { serverName } from "./server-name";
import { Activity } from "./activity";
import { listAgentCalls } from "@/lib/gateway/audit";

/**
 * Everything that can act on this business, in one place.
 *
 * Two ways in, shown in the order people should try them. Approving in the
 * browser is first because it involves no secret at all; a key is what you
 * reach for when the thing connecting has no browser, which is every server,
 * script and scheduled job.
 */
export default async function AgentKeysPage() {
  const org = await orgForPage();
  const [keys, connections, calls, baseUrl] = await Promise.all([
    listAgentKeys(org.id),
    listConnections(org.id),
    listAgentCalls(org.id, 25),
    appBaseUrl(),
  ]);

  const activeKeys = keys.filter((k) => k.is_active).length;
  const activeConnections = connections.filter((c) => !c.revoked_at).length;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Agents
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            What is allowed to reach your billing, and what each one can do
          </p>
        </div>
        <div className="rounded-2xl bg-white px-5 py-3 text-right shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Active
          </p>
          <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            {activeKeys + activeConnections}
          </p>
        </div>
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Connect an assistant
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            One command. It brings you back here to approve it, and nothing is
            copied or pasted.
          </p>
        </div>
        <ConnectCommand baseUrl={baseUrl} server={serverName(org.name)} />
        <Connections connections={connections} />
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Keys
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            For anything without a browser: a server, a script, a scheduled job
          </p>
        </div>
        <KeysManager keys={keys} />
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Activity
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            The last 25 things your agents asked for, refusals included. What
            they asked for is recorded; the invoices and clients themselves
            never are.
          </p>
        </div>
        <Activity calls={calls} />
      </section>
    </div>
  );
}
