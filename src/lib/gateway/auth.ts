import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashKey } from "./keys";

export type Agent = { id: string; label: string };

/**
 * Resolve the request's bearer / x-api-key to an active agent, or null. On a
 * match, the key's last_used_at is touched (best effort). The agent label signs
 * that agent's writes (created_by), so every invoice records who made it.
 */
export async function authenticateAgent(request: Request): Promise<Agent | null> {
  const raw = extractKey(request);
  if (!raw) return null;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("agent_keys")
    .select("id, label")
    .eq("key_hash", hashKey(raw))
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) return null;

  await supabase
    .from("agent_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);

  return data as Agent;
}

function extractKey(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim() || null;
  }
  const x = request.headers.get("x-api-key");
  return x ? x.trim() || null : null;
}
