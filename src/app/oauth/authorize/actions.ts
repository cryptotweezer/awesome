"use server";

import { redirect } from "next/navigation";
import { getCurrentOrg } from "@/lib/data/org";
import { getClient, issueCode } from "@/lib/oauth/store";
import { parseScopes } from "@/lib/gateway/scopes";

/**
 * The moment consent becomes a credential.
 *
 * Everything the browser sends here is re-read and re-checked. The consent
 * screen already validated it, but a form post is not proof that the screen
 * was rendered: the org, the user and the client all get resolved again from
 * the session and the database.
 */
export async function approveAuthorization(formData: FormData) {
  const ctx = await getCurrentOrg();
  if (!ctx) redirect("/login");

  const clientId = String(formData.get("client_id") ?? "");
  const redirectUri = String(formData.get("redirect_uri") ?? "");
  const challenge = String(formData.get("code_challenge") ?? "");
  const state = String(formData.get("state") ?? "");
  const scopes = parseScopes(formData.getAll("scope").map(String));

  const client = await getClient(clientId);
  if (!client || !client.redirect_uris.includes(redirectUri) || !challenge) {
    redirect("/oauth/authorize?error=invalid");
  }

  // Nothing ticked is a refusal, not a connection that can do nothing.
  if (scopes.length === 0) {
    redirect(deny(redirectUri, state, "access_denied", "No permissions were granted"));
  }

  const code = await issueCode({
    clientId,
    orgId: ctx.org.id,
    userId: ctx.member.user_id,
    userLabel: ctx.member.display_name || ctx.member.email,
    scopes,
    redirectUri,
    codeChallenge: challenge,
  });

  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  redirect(url.toString());
}

/** The user said no. The client is told, so it can stop waiting. */
export async function denyAuthorization(formData: FormData) {
  const redirectUri = String(formData.get("redirect_uri") ?? "");
  const state = String(formData.get("state") ?? "");
  const clientId = String(formData.get("client_id") ?? "");

  const client = await getClient(clientId);
  if (!client || !client.redirect_uris.includes(redirectUri)) {
    redirect("/");
  }
  redirect(deny(redirectUri, state, "access_denied", "The user declined"));
}

function deny(
  redirectUri: string,
  state: string,
  error: string,
  description: string,
): string {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}
