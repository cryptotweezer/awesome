import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateKey, hashKey } from "@/lib/gateway/keys";
import type { AgentKey } from "@/lib/types";

/**
 * Gateway API keys, one per AI agent. Only the hash is stored, so the raw key is
 * returned exactly once (at mint time) and can never be read back.
 */

export async function listAgentKeys(): Promise<AgentKey[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("agent_keys")
    .select("id, label, is_active, created_at, last_used_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to load agent keys: ${error.message}`);
  return (data ?? []) as AgentKey[];
}

/** Mint a fresh key. Returns the RAW key once — it is never stored in the clear. */
export async function mintAgentKey(
  label: string,
): Promise<{ label: string; key: string }> {
  const supabase = createAdminClient();
  const key = generateKey();
  const { error } = await supabase
    .from("agent_keys")
    .insert({ label, key_hash: hashKey(key) });
  if (error) throw new Error(`Failed to mint key: ${error.message}`);
  return { label, key };
}

/** Revoke (deactivate) or reactivate a key without deleting its audit row. */
export async function setAgentKeyActive(
  id: string,
  active: boolean,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("agent_keys")
    .update({ is_active: active })
    .eq("id", id);
  if (error) throw new Error(`Failed to update key: ${error.message}`);
}

/** Permanently remove a key row. */
export async function deleteAgentKey(id: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("agent_keys").delete().eq("id", id);
  if (error) throw new Error(`Failed to delete key: ${error.message}`);
}
