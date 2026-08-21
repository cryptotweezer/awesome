import "server-only";
import type { Agent } from "./auth";
import { authorizeTool, tools, type ToolDef, type ToolInput } from "./tools";
import { logAgentCall } from "./audit";
import { idempotencyKeyOf, recallWrite, rememberWrite } from "./idempotency";

/**
 * The one place a tool is run.
 *
 * There are three ways into this gateway (REST, MCP, and the assistant built
 * into the dashboard) and they used to each look the tool up, check the scope,
 * call the handler and shape the error on their own. Everything that has to
 * happen around a tool call therefore had to be written three times, which is
 * exactly how one of them ends up being the one that forgot.
 *
 * So the rules live here: the scope gate, the retry guard, and the log. A
 * transport's only job is to turn this outcome into its own shape.
 */

export type ToolOutcome =
  | { ok: true; result: unknown; replayed: boolean }
  | { ok: false; status: number; error: string; denied: boolean };

export type RunOptions = {
  /**
   * The assistant in the dashboard serves a few extra tools that exist only
   * there (it hands a person a file, where an agent wants a link). It passes
   * its own registry so those calls are gated and logged like every other.
   */
  registry?: Record<string, ToolDef>;
};

export async function runTool(
  name: string,
  input: ToolInput,
  agent: Agent,
  options: RunOptions = {},
): Promise<ToolOutcome> {
  const registry = options.registry ?? tools;
  const def = registry[name];
  if (!def) {
    return fail(404, `Unknown tool "${name}"`, false);
  }

  // Scope first, before the arguments are even looked at. Naming the missing
  // permission lets the agent tell its user what to re-authorise instead of
  // retrying blindly, and the denial is logged because a run of them is the
  // most useful thing this table ever shows.
  const missing = authorizeTool(name, agent, registry);
  if (missing) {
    const error =
      `This connection is not allowed to ${missing}. ` +
      `Ask the owner to grant the "${missing}" permission.`;
    await logAgentCall(agent, {
      tool: name,
      outcome: "denied",
      detail: `missing scope: ${missing}`,
      target: targetOf(input),
    });
    return fail(403, error, true);
  }

  const key = def.idempotent ? idempotencyKeyOf(input) : null;
  if (key) {
    const prior = await recallWrite(agent.orgId, name, key);
    if (prior !== null) {
      await logAgentCall(agent, {
        tool: name,
        outcome: "ok",
        detail: "replayed, same idempotency key",
        target: targetOf(input, prior),
      });
      return { ok: true, result: prior, replayed: true };
    }
  }

  try {
    const result = await def.handler(input, { agent });
    if (key) await rememberWrite(agent.orgId, name, key, result);
    await logAgentCall(agent, {
      tool: name,
      outcome: "ok",
      target: targetOf(input, result),
    });
    return { ok: true, result, replayed: false };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Failed";
    await logAgentCall(agent, {
      tool: name,
      outcome: "error",
      detail: error,
      target: targetOf(input),
    });
    return fail(400, error, false);
  }
}

function fail(status: number, error: string, denied: boolean): ToolOutcome {
  return { ok: false, status, error, denied };
}

/**
 * The one record this call was about, when there obviously is one. Read off
 * the arguments so it is known even when the call failed, and off the result
 * for a create, which is the case where the arguments do not name it yet.
 */
function targetOf(input: ToolInput, result?: unknown): string | null {
  const fromResult =
    result && typeof result === "object" && "invoice_number" in result
      ? String((result as { invoice_number: unknown }).invoice_number)
      : null;
  if (fromResult) return `invoice ${fromResult}`;

  const invoice = input.invoice ?? input.invoice_number;
  if (typeof invoice === "string" || typeof invoice === "number") {
    return `invoice ${invoice}`;
  }
  if (typeof input.client === "string" && input.client.trim()) {
    return input.client.trim();
  }
  if (typeof input.name === "string" && input.name.trim()) {
    return input.name.trim();
  }
  return null;
}
