import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateKey, hashKey } from "@/lib/gateway/keys";
import { ALL_SCOPES, type Scope } from "@/lib/gateway/scopes";
import type { AgentKey } from "@/lib/types";

/**
 * Gateway API keys, one per AI agent. Only the hash is stored, so the raw key is
 * returned exactly once (at mint time) and can never be read back.
 *
 * A key belongs to one organisation and can only ever reach that organisation's
 * data: the gateway resolves the key to its org_id and every tool is scoped by
 * it. That is what makes it safe to hand a key to somebody else's Claude.
 */

export async function listAgentKeys(orgId: string): Promise<AgentKey[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("agent_keys")
    .select("id, org_id, label, is_active, scopes, expires_at, created_at, last_used_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to load agent keys: ${error.message}`);
  return (data ?? []) as AgentKey[];
}

/**
 * Mint a fresh key. Returns the RAW key once, it is never stored in the clear.
 *
 * Scopes default to everything, which is what every key minted before scopes
 * existed already has: adding a permission model must not quietly disable
 * agents that are working.
 */
export async function mintAgentKey(
  orgId: string,
  label: string,
  options: { scopes?: Scope[]; expiresAt?: string | null } = {},
): Promise<{ label: string; key: string }> {
  const supabase = createAdminClient();
  const key = generateKey();
  const scopes = options.scopes?.length ? options.scopes : ALL_SCOPES;
  const { error } = await supabase.from("agent_keys").insert({
    label,
    key_hash: hashKey(key),
    org_id: orgId,
    scopes,
    expires_at: options.expiresAt ?? null,
  });
  if (error) throw new Error(`Failed to mint key: ${error.message}`);
  return { label, key };
}

/** Revoke (deactivate) or reactivate a key without deleting its audit row. */
export async function setAgentKeyActive(
  orgId: string,
  id: string,
  active: boolean,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("agent_keys")
    .update({ is_active: active })
    .eq("org_id", orgId)
    .eq("id", id);
  if (error) throw new Error(`Failed to update key: ${error.message}`);
}

/** Permanently remove a key row. */
export async function deleteAgentKey(
  orgId: string,
  id: string,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("agent_keys")
    .delete()
    .eq("org_id", orgId)
    .eq("id", id);
  if (error) throw new Error(`Failed to delete key: ${error.message}`);
}
