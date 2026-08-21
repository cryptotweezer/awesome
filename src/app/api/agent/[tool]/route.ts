import type { NextRequest } from "next/server";
import { authenticateAgent, unauthorizedHeaders } from "@/lib/gateway/auth";
import { appBaseUrl } from "@/lib/app-url";
import { runTool } from "@/lib/gateway/dispatch";
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

  // Everything that happens around a tool call (the scope gate, the retry
  // guard, the log) lives in one dispatcher both transports share, so this
  // route only has to turn the outcome into HTTP.
  const outcome = await runTool(tool, input, agent);
  return outcome.ok
    ? json({ ok: true, result: outcome.result }, 200)
    : json({ ok: false, error: outcome.error }, outcome.status);
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
