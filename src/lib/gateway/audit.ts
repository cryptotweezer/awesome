import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Agent } from "./auth";

/**
 * What an agent did, whether or not it was allowed to.
 *
 * Writes are already signed on the record itself (`created_by`), which answers
 * "who raised this invoice" months later from the screen a person is already
 * looking at. This is the other half: an append-only record of every call,
 * including the ones that were refused, which is the only place a denial shows
 * up at all.
 *
 * Never stored: the arguments and the results. They are the business's own
 * data, and a log that duplicates the database is a second copy to protect for
 * nothing. `target` is the one exception, and only when there is an obvious
 * single record, because a log you have to join against the database to read
 * is a log nobody reads.
 */

export type CallOutcome = "ok" | "denied" | "error";

export type AgentCall = {
  id: string;
  at: string;
  credential_id: string | null;
  credential_label: string;
  via: "key" | "oauth" | "session";
  tool: string;
  outcome: CallOutcome;
  detail: string | null;
  target: string | null;
};

/** Longer than this is a stack trace or a paragraph, and neither belongs here. */
const DETAIL_MAX = 300;

/**
 * Record one call. This must never be the reason a tool call fails: the log is
 * useful, the invoice is the point. Anything that goes wrong here is swallowed
 * after being printed, and the caller gets its result either way.
 */
export async function logAgentCall(
  agent: Agent,
  entry: {
    tool: string;
    outcome: CallOutcome;
    detail?: string | null;
    target?: string | null;
  },
): Promise<void> {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("agent_calls").insert({
      org_id: agent.orgId,
      credential_id: agent.via === "session" ? null : agent.id,
      credential_label: agent.label,
      via: agent.via,
      tool: entry.tool,
      outcome: entry.outcome,
      detail: entry.detail ? entry.detail.slice(0, DETAIL_MAX) : null,
      target: entry.target ? entry.target.slice(0, 120) : null,
    });
    if (error) console.error("agent_calls insert failed:", error.message);
  } catch (e) {
    console.error("agent_calls insert threw:", e);
  }
}

/**
 * The recent history for one business, newest first. Shown on the Agents page:
 * most of the value is not forensic, it is that a person can see what their
 * assistant actually did.
 */
export async function listAgentCalls(
  orgId: string,
  limit = 25,
): Promise<AgentCall[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("agent_calls")
    .select("id, at, credential_id, credential_label, via, tool, outcome, detail, target")
    .eq("org_id", orgId)
    .order("at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to load agent activity: ${error.message}`);
  return (data ?? []) as AgentCall[];
}
