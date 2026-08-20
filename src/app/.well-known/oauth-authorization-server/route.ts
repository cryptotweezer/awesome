import { appBaseUrl } from "@/lib/app-url";
import { SCOPES } from "@/lib/gateway/scopes";

/**
 * What this app supports as an OAuth 2.1 authorization server.
 *
 * Only the authorization code grant, only PKCE with S256, and no implicit or
 * password grants: OAuth 2.1 removes them and there is no reason to revive
 * them for a machine client.
 *
 * `registration_endpoint` is advertised because assistants register
 * themselves. An assistant on somebody's laptop cannot have been registered by
 * us in advance, so without dynamic registration the whole flow is manual.
 */
export async function GET() {
  const base = await appBaseUrl();
  return json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    revocation_endpoint: `${base}/api/oauth/revoke`,
    scopes_supported: [...SCOPES],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    service_documentation: `${base}/guide`,
  });
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
