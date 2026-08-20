import type { NextRequest } from "next/server";
import { authenticateAgent, unauthorizedHeaders } from "@/lib/gateway/auth";
import { appBaseUrl } from "@/lib/app-url";
import { authorizeTool, tools } from "@/lib/gateway/tools";
import { protectGateway } from "@/lib/security/arcjet";

/**
 * REST gateway. Every agent capability is POST /api/agent/<tool> with a JSON
 * body, authenticated by a per-agent key (Authorization: Bearer <key>, or
 * x-api-key). This is the universal transport; MCP-native agents get the same
 * tools over /api/mcp. service_role never leaves the server.
 *
 *   POST /api/agent/who_owes          {}
 *   POST /api/agent/create_invoice    { client_id, issuer_id, items:[...] }
 *   POST /api/agent/mark_paid         { invoice: 1954 }
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/agent/[tool]">,
) {
  const agent = await authenticateAgent(request);
  if (!agent) {
    return json({ ok: false, error: "Unauthorized" }, 401, unauthorizedHeaders(await appBaseUrl()));
  }

  // Rate limited per key, after authentication, so one agent's runaway loop
  // cannot spend another agent's budget.
  const guard = await protectGateway(request, agent.id);
  if (!guard.ok) return json({ ok: false, error: guard.reason }, guard.status);

  const { tool } = await ctx.params;
  const def = tools[tool];
  if (!def) return json({ ok: false, error: `Unknown tool "${tool}"` }, 404);

  // Scope, before the body is even parsed. Naming the missing scope lets the
  // agent tell its user what to re-authorise instead of retrying blindly.
  const missing = authorizeTool(tool, agent);
  if (missing) {
    return json(
      {
        ok: false,
        error: `This connection is not allowed to ${missing}. Ask the owner to grant the "${missing}" permission.`,
      },
      403,
    );
  }

  let input: Record<string, unknown> = {};
  try {
    const text = await request.text();
    if (text.trim()) {
      const parsed = JSON.parse(text);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return json({ ok: false, error: "Body must be a JSON object" }, 400);
      }
      input = parsed as Record<string, unknown>;
    }
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  try {
    const result = await def.handler(input, { agent });
    return json({ ok: true, result }, 200);
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Failed" },
      400,
    );
  }
}

function json(
  body: unknown,
  status: number,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extra,
    },
  });
}
