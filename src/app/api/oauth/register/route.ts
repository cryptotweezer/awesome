import type { NextRequest } from "next/server";
import { registerClient } from "@/lib/oauth/store";

/**
 * Dynamic client registration (RFC 7591).
 *
 * Anybody can register. That is not a hole, it is the design: registering only
 * gets you a name and a redirect URI, and nothing at all happens until a real
 * person reads that name on our consent screen and approves it. The trust
 * decision belongs to the user, not to this endpoint.
 *
 * What we do enforce is that a redirect URI is somewhere a token can safely
 * land: https, or a loopback address, which is how a CLI assistant on
 * somebody's machine receives its callback.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return err("invalid_client_metadata", "Body must be JSON");
  }

  const uris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((u): u is string => typeof u === "string")
    : [];
  if (uris.length === 0) {
    return err("invalid_redirect_uri", "At least one redirect_uri is required");
  }
  for (const uri of uris) {
    if (!isAcceptableRedirect(uri)) {
      return err(
        "invalid_redirect_uri",
        `Redirect URI must be https or a loopback address: ${uri}`,
      );
    }
  }

  const name =
    typeof body.client_name === "string" && body.client_name.trim()
      ? body.client_name.trim()
      : "Unnamed assistant";

  // Public clients (PKCE, no secret) are the norm for something running on a
  // person's own machine, where a shipped secret is not a secret.
  const method = body.token_endpoint_auth_method;
  const wantsSecret = method === "client_secret_post" || method === "client_secret_basic";

  const { client, client_secret } = await registerClient({
    client_name: name,
    redirect_uris: uris,
    wants_secret: wantsSecret,
  });

  return new Response(
    JSON.stringify({
      client_id: client.client_id,
      ...(client_secret ? { client_secret } : {}),
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: wantsSecret ? "client_secret_post" : "none",
    }),
    {
      status: 201,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    },
  );
}

function isAcceptableRedirect(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  if (
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]")
  ) {
    return true;
  }
  return false;
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
