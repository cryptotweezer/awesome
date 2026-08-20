import "server-only";
import { randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateToken, hashKey } from "@/lib/gateway/keys";
import { parseScopes, type Scope } from "@/lib/gateway/scopes";
import {
  ACCESS_TTL_SECONDS,
  CODE_TTL_SECONDS,
  type IssuedTokens,
} from "./credentials";

/**
 * The storage behind our own OAuth 2.1 authorization server: clients, consent,
 * and the connections an owner can see and cut off.
 *
 * We issue opaque tokens and keep only their hash, exactly as we do for API
 * keys. A signed JWT would save one lookup per request and cost us the thing
 * that matters more here: revoking a connection has to stop it immediately,
 * not whenever the token happens to expire.
 *
 * The lookups that turn a presented secret INTO an identity live next door in
 * `credentials.ts`, because they are the only OAuth queries that cannot name
 * an organisation: producing one is their job. Everything in this file can
 * name one, and the org-scoping test holds it to that.
 */

export type OAuthClient = {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  client_secret_hash: string | null;
};

export type Connection = {
  id: string;
  org_id: string;
  user_id: string;
  client_id: string;
  client_name: string;
  label: string;
  scopes: Scope[];
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
};

// ---------------------------------------------------------------- clients

/**
 * Register a client. Assistants register themselves (dynamic registration),
 * because an assistant on somebody's laptop cannot have been registered by us
 * in advance.
 *
 * A row here is NOT a trusted party. It is a name that will be shown to a
 * person on the consent screen before they decide, which is where the actual
 * trust decision happens.
 */
export async function registerClient(input: {
  client_name: string;
  redirect_uris: string[];
  wants_secret: boolean;
}): Promise<{ client: OAuthClient; client_secret?: string }> {
  const supabase = createAdminClient();
  const client_id = `awsc_${randomBytes(16).toString("base64url")}`;
  const secret = input.wants_secret ? generateToken() : undefined;

  const { data, error } = await supabase
    .from("oauth_clients")
    .insert({
      client_id,
      client_name: input.client_name.slice(0, 120),
      redirect_uris: input.redirect_uris,
      client_secret_hash: secret ? hashKey(secret) : null,
    })
    .select("client_id, client_name, redirect_uris, client_secret_hash")
    .single();
  if (error) throw new Error(`Failed to register client: ${error.message}`);

  return { client: data as OAuthClient, client_secret: secret };
}

export async function getClient(clientId: string): Promise<OAuthClient | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("oauth_clients")
    .select("client_id, client_name, redirect_uris, client_secret_hash")
    .eq("client_id", clientId)
    .maybeSingle();
  return (data as OAuthClient) ?? null;
}

// ------------------------------------------------------------------ codes

/**
 * Record a consent and hand back the code the browser carries home.
 *
 * The code is bound to the client, the redirect URI and the PKCE challenge.
 * All three are checked again at the token endpoint, so intercepting the code
 * alone gets an attacker nothing.
 */
export async function issueCode(input: {
  clientId: string;
  orgId: string;
  userId: string;
  userLabel: string;
  scopes: Scope[];
  redirectUri: string;
  codeChallenge: string;
}): Promise<string> {
  const supabase = createAdminClient();
  const code = `awsx_${randomBytes(32).toString("base64url")}`;
  const { error } = await supabase.from("oauth_codes").insert({
    code_hash: hashKey(code),
    client_id: input.clientId,
    org_id: input.orgId,
    user_id: input.userId,
    user_label: input.userLabel,
    scopes: input.scopes,
    redirect_uri: input.redirectUri,
    code_challenge: input.codeChallenge,
    expires_at: new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString(),
  });
  if (error) throw new Error(`Failed to issue code: ${error.message}`);
  return code;
}

/** Create the connection row and its first pair of tokens. */
export async function issueTokens(input: {
  orgId: string;
  userId: string;
  clientId: string;
  clientName: string;
  userLabel: string;
  scopes: Scope[];
}): Promise<IssuedTokens> {
  const supabase = createAdminClient();
  const access = generateToken();
  const refresh = generateToken();

  const { error } = await supabase.from("oauth_tokens").insert({
    org_id: input.orgId,
    user_id: input.userId,
    client_id: input.clientId,
    client_name: input.clientName,
    // What signs this connection's writes. A person reading `created_by` on an
    // invoice months later should be able to tell which assistant, acting for
    // whom, made it.
    label: `${input.clientName} (${input.userLabel})`,
    scopes: input.scopes,
    access_token_hash: hashKey(access),
    access_expires_at: new Date(Date.now() + ACCESS_TTL_SECONDS * 1000).toISOString(),
    refresh_token_hash: hashKey(refresh),
  });
  if (error) throw new Error(`Failed to issue tokens: ${error.message}`);

  return {
    access_token: access,
    refresh_token: refresh,
    expires_in: ACCESS_TTL_SECONDS,
    scope: input.scopes.join(" "),
  };
}

// ------------------------------------------------------------ connections

export async function listConnections(orgId: string): Promise<Connection[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("oauth_tokens")
    .select("id, org_id, user_id, client_id, client_name, label, scopes, revoked_at, last_used_at, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to load connections: ${error.message}`);
  return (data ?? []).map((row) => ({
    ...row,
    scopes: parseScopes(row.scopes),
  })) as Connection[];
}

/**
 * Revoke a connection. Clearing both hashes as well as stamping `revoked_at`
 * means the tokens stop resolving even if some future query forgets to check
 * the flag.
 */
export async function revokeConnection(orgId: string, id: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("oauth_tokens")
    .update({
      revoked_at: new Date().toISOString(),
      access_token_hash: null,
      refresh_token_hash: null,
    })
    .eq("org_id", orgId)
    .eq("id", id);
  if (error) throw new Error(`Failed to revoke connection: ${error.message}`);
}

export async function deleteConnection(orgId: string, id: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("oauth_tokens")
    .delete()
    .eq("org_id", orgId)
    .eq("id", id);
  if (error) throw new Error(`Failed to delete connection: ${error.message}`);
}
