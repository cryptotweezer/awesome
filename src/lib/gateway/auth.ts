import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashKey, KEY_PREFIX, TOKEN_PREFIX } from "./keys";
import { effectiveScopes, parseScopes, type Scope } from "./scopes";
import { findByAccessToken, touchToken } from "@/lib/oauth/credentials";

/**
 * Who is calling the gateway. Two doors produce this same object, and nothing
 * downstream ever asks which one was used.
 *
 * `orgId` is the ONLY thing deciding which business this request can see. It
 * is resolved here, once, from the credential, and threaded through every
 * tool. A caller can never supply or override it.
 *
 * `label` signs that agent's writes (created_by), so every invoice records who
 * made it: a key's label for API keys, 'Client (Person)' for an OAuth
 * connection.
 */
export type Agent = {
  id: string;
  label: string;
  orgId: string;
  scopes: Scope[];
  /**
   * Which door this caller came through. "session" is the assistant built into
   * the dashboard, acting for the signed-in person rather than for a
   * credential handed to somebody else's software.
   */
  via: "key" | "oauth" | "session";
};

export async function authenticateAgent(request: Request): Promise<Agent | null> {
  const raw = extractCredential(request);
  if (!raw) return null;

  // The prefix is what makes this branch unambiguous, which is the practical
  // reason both credential kinds carry one.
  if (raw.startsWith(TOKEN_PREFIX)) return authenticateOAuth(raw);
  if (raw.startsWith(KEY_PREFIX)) return authenticateKey(raw);

  // Unprefixed: an older key, or a guess. Try the key table and nothing else.
  return authenticateKey(raw);
}

async function authenticateKey(raw: string): Promise<Agent | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("agent_keys")
    .select("id, label, org_id, scopes, expires_at")
    .eq("key_hash", hashKey(raw))
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) return null;

  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
    return null;
  }

  const now = new Date().toISOString();
  await supabase.from("agent_keys").update({ last_used_at: now }).eq("id", data.id);
  await touchOrg(data.org_id, now);

  return {
    id: data.id,
    label: data.label,
    orgId: data.org_id,
    scopes: effectiveScopes(parseScopes(data.scopes)),
    via: "key",
  };
}

async function authenticateOAuth(raw: string): Promise<Agent | null> {
  const found = await findByAccessToken(raw);
  if (!found) return null;

  const now = new Date().toISOString();
  await touchToken(found.id);
  await touchOrg(found.orgId, now);

  return {
    id: found.id,
    label: found.label,
    orgId: found.orgId,
    scopes: effectiveScopes(found.scopes),
    via: "oauth",
  };
}

/**
 * An agent working counts as the business being alive, which is what keeps a
 * trial organisation from being purged while somebody is still using it.
 */
async function touchOrg(orgId: string, now: string): Promise<void> {
  const supabase = createAdminClient();
  await supabase.from("orgs").update({ last_active_at: now }).eq("id", orgId);
}

function extractCredential(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim() || null;
  }
  const x = request.headers.get("x-api-key");
  return x ? x.trim() || null : null;
}

/**
 * What an unauthenticated caller is told. The pointer to our protected
 * resource metadata is what lets an MCP client start the OAuth flow on its
 * own; without this header it has nowhere to look and simply gives up.
 */
export function unauthorizedHeaders(baseUrl: string): Record<string, string> {
  return {
    "WWW-Authenticate": `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
  };
}
