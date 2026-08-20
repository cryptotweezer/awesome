import { appBaseUrl } from "@/lib/app-url";
import { SCOPES } from "@/lib/gateway/scopes";

/**
 * How an MCP client discovers who can authorise it for this gateway.
 *
 * This document, plus the `WWW-Authenticate` header on our 401s, is the entire
 * bootstrap: a client that arrives with no credential reads the header, fetches
 * this, and knows where to send the user. Without it the flow never starts and
 * the client simply reports that it cannot connect.
 *
 * We name ourselves as our own authorization server. The alternative was
 * Supabase's OAuth server, which ties the consent screen to the project's
 * single Site URL. That project is shared with two unrelated apps, so taking
 * the slot would have coupled them and spent a resource none of them can get
 * back.
 */
export async function GET() {
  const base = await appBaseUrl();
  return json({
    resource: `${base}/api/mcp`,
    authorization_servers: [base],
    scopes_supported: [...SCOPES],
    bearer_methods_supported: ["header"],
    resource_documentation: `${base}/guide`,
  });
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // Public, unauthenticated, and read constantly by clients.
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
