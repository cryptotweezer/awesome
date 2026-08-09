import Link from "next/link";
import { requireOrg } from "@/lib/data/org";
import { listClients } from "@/lib/data/clients";
import { Chat } from "./chat";

export default async function AssistantPage() {
  const { org } = await requireOrg();
  const clients = await listClients(org.id);

  // Suggestions that work on this business's actual data, so the first thing
  // anyone tries returns something real rather than an empty result.
  const someone = clients[0]?.name;
  const suggestions = [
    "What am I owed?",
    "Which invoices are overdue?",
    someone ? `How is ${someone}'s account?` : "Show me my recent invoices",
    "What did I bill this financial year?",
  ];

  const remaining =
    org.max_ai_messages === null
      ? null
      : Math.max(0, org.max_ai_messages - org.ai_messages_used);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Assistant
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            It works on your real data, through the same rules as the rest of
            the app
          </p>
        </div>
        {remaining !== null && (
          <Link
            href="/guide"
            className="shrink-0 rounded-lg px-4 py-2.5 text-sm font-medium text-slate-700 ring-1 ring-slate-300 transition hover:bg-white dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-800"
          >
            Connect your own AI
          </Link>
        )}
      </div>

      <Chat suggestions={suggestions} remaining={remaining} />
    </div>
  );
}
