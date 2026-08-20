import type { NextRequest } from "next/server";
import { getClient, issueTokens } from "@/lib/oauth/store";
import { redeemCode, refreshTokens } from "@/lib/oauth/credentials";
import { hashKey, safeEqual } from "@/lib/gateway/keys";

/**
 * The token endpoint. Two grants, both of which end with a fresh pair of
 * opaque tokens.
 *
 *   authorization_code  the code the browser brought back, plus the PKCE
 *                       verifier proving this is the same client that started
 *   refresh_token       rotate an existing connection's tokens
 *
 * Accepts form encoding, which is what OAuth specifies and what every client
 * sends, and JSON as well because a few send that instead.
 */
export async function POST(request: NextRequest) {
  const body = await readBody(request);
  const grant = str(body.grant_type);
  const clientId = str(body.client_id);
  if (!clientId) return err("invalid_client", "client_id is required");

  const client = await getClient(clientId);
  if (!client) return err("invalid_client", "Unknown client");

  // A client that registered with a secret must present it. One that did not
  // relies on PKCE, which is what protects a public client.
  if (client.client_secret_hash) {
    const secret = str(body.client_secret);
    if (!secret || !safeEqual(hashKey(secret), client.client_secret_hash)) {
      return err("invalid_client", "Bad client credentials");
    }
  }

  if (grant === "authorization_code") {
    const code = str(body.code);
    const verifier = str(body.code_verifier);
    const redirectUri = str(body.redirect_uri);
    if (!code || !verifier || !redirectUri) {
      return err("invalid_request", "code, code_verifier and redirect_uri are required");
    }

    const redeemed = await redeemCode(code, clientId, redirectUri, verifier);
    if (!redeemed.ok) {
      return err("invalid_grant", "The code is expired, already used, or does not match");
    }

    const tokens = await issueTokens({
      orgId: redeemed.row.org_id,
      userId: redeemed.row.user_id,
      clientId,
      clientName: client.client_name,
      userLabel: redeemed.row.user_label,
      scopes: redeemed.row.scopes,
    });
    return ok(tokens);
  }

  if (grant === "refresh_token") {
    const refresh = str(body.refresh_token);
    if (!refresh) return err("invalid_request", "refresh_token is required");
    const tokens = await refreshTokens(refresh, clientId);
    if (!tokens) {
      return err("invalid_grant", "The refresh token is unknown or the connection was revoked");
    }
    return ok(tokens);
  }

  return err("unsupported_grant_type", `Unsupported grant_type: ${grant ?? "(none)"}`);
}

async function readBody(request: NextRequest): Promise<Record<string, unknown>> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    try {
      return (await request.json()) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  const form = await request.formData();
  const out: Record<string, unknown> = {};
  for (const [k, v] of form.entries()) out[k] = typeof v === "string" ? v : undefined;
  return out;
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

function ok(tokens: {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}): Response {
  return new Response(
    JSON.stringify({ token_type: "Bearer", ...tokens }),
    {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    },
  );
}

function err(error: string, description: string): Response {
  return new Response(
    JSON.stringify({ error, error_description: description }),
    {
      status: 400,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    },
  );
}
