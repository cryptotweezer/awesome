import "server-only";
import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateToken, hashKey, safeEqual } from "@/lib/gateway/keys";
import { parseScopes, type Scope } from "@/lib/gateway/scopes";

/**
 * The queries that turn a presented secret into an identity, and nothing else.
 *
 * They are here rather than in `store.ts` because they are the only OAuth
 * queries that cannot filter by organisation: they run BEFORE there is an
 * organisation to name, and producing it is their whole job. Keeping them in
 * their own file means `tests/org-scoping.test.mjs` can exempt this file alone
 * while still checking every other query in the module, so a future
 * `listConnections` that forgets its org_id still fails loudly.
 *
 * Every lookup here is by the hash of the presented secret. Nothing in this
 * file accepts an organisation, a user or a row id from a caller.
 */

/** How long an authorization code is worth anything. Long enough for one redirect. */
export const CODE_TTL_SECONDS = 60;
/** Access tokens are short. The refresh token is what the assistant keeps. */
export const ACCESS_TTL_SECONDS = 60 * 60;

export type IssuedTokens = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
};

/**
 * Redeem a code, once. Marking it used is conditional on it still being
 * unused, so two simultaneous redemptions cannot both win.
 */
export async function redeemCode(
  code: string,
  clientId: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<
  | {
      ok: true;
      row: { org_id: string; user_id: string; user_label: string; scopes: Scope[] };
    }
  | { ok: false; error: string }
> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("oauth_codes")
    .select(
      "id, client_id, org_id, user_id, user_label, scopes, redirect_uri, code_challenge, expires_at, used_at",
    )
    .eq("code_hash", hashKey(code))
    .maybeSingle();

  if (!data) return { ok: false, error: "invalid_grant" };
  if (data.used_at) return { ok: false, error: "invalid_grant" };
  if (new Date(data.expires_at).getTime() < Date.now()) {
    return { ok: false, error: "invalid_grant" };
  }
  if (data.client_id !== clientId) return { ok: false, error: "invalid_grant" };
  if (data.redirect_uri !== redirectUri) return { ok: false, error: "invalid_grant" };

  // PKCE S256: the verifier must hash to the challenge recorded at consent.
  // This is what proves the client redeeming the code is the one that started
  // the flow, and it is why intercepting a code alone achieves nothing.
  const computed = createHash("sha256").update(codeVerifier).digest("base64url");
  if (!safeEqual(computed, data.code_challenge)) {
    return { ok: false, error: "invalid_grant" };
  }

  const { data: claimed } = await supabase
    .from("oauth_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", data.id)
    .is("used_at", null)
    .select("id")
    .maybeSingle();
  if (!claimed) return { ok: false, error: "invalid_grant" };

  return {
    ok: true,
    row: {
      org_id: data.org_id,
      user_id: data.user_id,
      user_label: data.user_label,
      scopes: parseScopes(data.scopes),
    },
  };
}

/**
 * Exchange a refresh token for a new pair, rotating both. Rotation means a
 * stolen refresh token stops working the moment the real client uses its own,
 * which is how theft becomes visible instead of permanent.
 */
export async function refreshTokens(
  refreshToken: string,
  clientId: string,
): Promise<IssuedTokens | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("oauth_tokens")
    .select("id, client_id, scopes, revoked_at")
    .eq("refresh_token_hash", hashKey(refreshToken))
    .maybeSingle();
  if (!data || data.revoked_at || data.client_id !== clientId) return null;

  const access = generateToken();
  const refresh = generateToken();
  const { data: rotated } = await supabase
    .from("oauth_tokens")
    .update({
      access_token_hash: hashKey(access),
      access_expires_at: new Date(Date.now() + ACCESS_TTL_SECONDS * 1000).toISOString(),
      refresh_token_hash: hashKey(refresh),
    })
    .eq("id", data.id)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (!rotated) return null;

  return {
    access_token: access,
    refresh_token: refresh,
    expires_in: ACCESS_TTL_SECONDS,
    scope: parseScopes(data.scopes).join(" "),
  };
}

/**
 * Resolve an access token to a live connection. This is the OAuth equivalent
 * of looking a key up by its hash, and the org it returns is the only thing
 * deciding what the request can see.
 */
export async function findByAccessToken(token: string) {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("oauth_tokens")
    .select("id, org_id, label, scopes, access_expires_at, revoked_at")
    .eq("access_token_hash", hashKey(token))
    .maybeSingle();
  if (!data || data.revoked_at) return null;
  if (!data.access_expires_at) return null;
  if (new Date(data.access_expires_at).getTime() < Date.now()) return null;
  return {
    id: data.id as string,
    orgId: data.org_id as string,
    label: data.label as string,
    scopes: parseScopes(data.scopes),
  };
}

export async function touchToken(id: string): Promise<void> {
  const supabase = createAdminClient();
  await supabase
    .from("oauth_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", id);
}

/**
 * Hand a token back (RFC 7009). Either half of the pair kills the whole
 * connection: revoking an access token and leaving the refresh token alive
 * would revoke nothing, since the client would simply renew.
 */
export async function revokeByToken(token: string): Promise<void> {
  const supabase = createAdminClient();
  const hash = hashKey(token);
  await supabase
    .from("oauth_tokens")
    .update({
      revoked_at: new Date().toISOString(),
      access_token_hash: null,
      refresh_token_hash: null,
    })
    .or(`access_token_hash.eq.${hash},refresh_token_hash.eq.${hash}`)
    .is("revoked_at", null);
}
