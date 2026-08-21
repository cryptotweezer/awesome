import type { NextRequest } from "next/server";
import {
  authenticateAgent,
  unauthorizedHeaders,
  type Agent,
} from "@/lib/gateway/auth";
import { tools } from "@/lib/gateway/tools";
import { runTool } from "@/lib/gateway/dispatch";
import { appBaseUrl } from "@/lib/app-url";
import { protectGateway } from "@/lib/security/arcjet";

/**
 * MCP endpoint (stateless Streamable HTTP). Exposes the same gateway tools as
 * the REST layer to MCP-native agents (Claude, Codex). Each POST is a
 * self-contained JSON-RPC 2.0 message (or batch); the server replies with JSON.
 * Auth is the per-agent key (Authorization: Bearer <key> or x-api-key), same as
 * REST, so service_role never leaves the server.
 */

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "awesome-billing", version: "1.0.0" };

type JsonRpcId = string | number | null;
type Incoming = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
};

export async function POST(request: NextRequest) {
  const agent = await authenticateAgent(request);
  if (!agent) {
    // The pointer to our protected resource metadata is what lets a client
    // with no credential start the OAuth flow by itself. Without this header
    // it has nowhere to look and reports that it cannot connect.
    return json({ error: "Unauthorized" }, 401, unauthorizedHeaders(await appBaseUrl()));
  }

  // Rate limited per key, after authentication. Note there is no bot detection
  // here: the callers are bots by design, that is the whole product.
  const guard = await protectGateway(request, agent.id);
  if (!guard.ok) return json({ error: guard.reason }, guard.status);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      200,
    );
  }

  const batch = Array.isArray(payload);
  const messages = (batch ? payload : [payload]) as Incoming[];
  const responses: object[] = [];
  for (const msg of messages) {
    const res = await handle(msg, agent);
    if (res) responses.push(res);
  }

  // Only notifications -> nothing to return.
  if (responses.length === 0) return new Response(null, { status: 202 });
  return json(batch ? responses : responses[0], 200);
}

export async function GET() {
  // No server-initiated stream in stateless mode.
  return new Response("Method Not Allowed", { status: 405 });
}

async function handle(msg: Incoming, agent: Agent): Promise<object | null> {
  const id = msg?.id ?? null;
  const isNotification = msg?.id === undefined || msg?.id === null;
  const params = msg?.params ?? {};

  try {
    switch (msg?.method) {
      case "initialize":
        return ok(id, {
          protocolVersion:
            typeof params.protocolVersion === "string"
              ? params.protocolVersion
              : PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });

      case "notifications/initialized":
      case "notifications/cancelled":
        return null;

      case "ping":
        return ok(id, {});

      case "tools/list":
        return ok(id, {
          tools: Object.entries(tools).map(([name, def]) => ({
            name,
            description: def.description,
            inputSchema: def.schema ?? { type: "object", additionalProperties: true },
          })),
        });

      case "tools/call": {
        const name = typeof params.name === "string" ? params.name : "";
        if (!tools[name]) return err(id, -32602, `Unknown tool "${name}"`);

        // The scope gate, the retry guard and the log all live in the one
        // dispatcher both transports share, so a tool can never be the one
        // that forgot. Here that leaves only the wire shape.
        const args = (params.arguments ?? {}) as Record<string, unknown>;
        const outcome = await runTool(name, args, agent);
        if (!outcome.ok) {
          // A refusal is a result with isError, not a protocol error: the
          // model has to be able to read it and tell the person.
          return ok(id, {
            content: [
              {
                type: "text",
                text: outcome.denied
                  ? `${outcome.error} Then reconnect.`
                  : outcome.error,
              },
            ],
            isError: true,
          });
        }
        // A handler that answers with nothing must still send text: an
        // undefined `text` disappears in serialisation and the client is
        // handed a content block with no content.
        return ok(id, {
          content: [
            { type: "text", text: JSON.stringify(outcome.result ?? { ok: true }) },
          ],
        });
      }

      default:
        return isNotification
          ? null
          : err(id, -32601, `Method not found: ${msg?.method}`);
    }
  } catch (e) {
    return isNotification
      ? null
      : err(id, -32603, e instanceof Error ? e.message : "Internal error");
  }
}

function ok(id: JsonRpcId, result: object) {
  return { jsonrpc: "2.0", id, result };
}
function err(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
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
