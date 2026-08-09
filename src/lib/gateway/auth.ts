import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashKey } from "./keys";

export type Agent = { id: string; label: string; orgId: string };

/**
 * Resolve the request's bearer / x-api-key to an active agent, or null. On a
 * match, the key's last_used_at is touched (best effort). The agent label signs
 * that agent's writes (created_by), so every invoice records who made it.
 *
 * The org_id on the key is the ONLY thing that decides which business this
 * request can see. It is read here, once, and threaded through every tool; a
 * caller can never supply or override it.
 */
export async function authenticateAgent(request: Request): Promise<Agent | null> {
  const raw = extractKey(request);
  if (!raw) return null;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("agent_keys")
    .select("id, label, org_id")
    .eq("key_hash", hashKey(raw))
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) return null;

  const now = new Date().toISOString();
  await supabase
    .from("agent_keys")
    .update({ last_used_at: now })
    .eq("id", data.id);
  // An agent working counts as the business being alive, which is what keeps a
  // trial organisation from being purged while somebody is still using it.
  await supabase
    .from("orgs")
    .update({ last_active_at: now })
    .eq("id", data.org_id);

  return { id: data.id, label: data.label, orgId: data.org_id };
}

function extractKey(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim() || null;
  }
  const x = request.headers.get("x-api-key");
  return x ? x.trim() || null : null;
}
