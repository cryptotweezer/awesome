import "server-only";
import { tools, type ToolContext } from "@/lib/gateway/tools";
import type { Org, OrgMember } from "@/lib/types";

/**
 * The dashboard assistant.
 *
 * It runs on exactly the same tool registry the MCP gateway serves, with one
 * difference: the caller is a signed-in person rather than an agent key, so the
 * organisation comes from the session. Nothing is reimplemented here, which is
 * the point. A rule enforced for agents is enforced for the assistant for free.
 *
 * No SDK: the chat completions API is one HTTP call, and one fewer dependency
 * is one fewer thing to keep current.
 */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

/**
 * Configurable because model names move faster than this codebase does.
 * A small model is the right default: the work here is calling functions
 * accurately, not writing prose.
 */
const MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini";

/** A runaway tool loop is a bill, so it is bounded. */
const MAX_TOOL_ROUNDS = 6;

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AssistantReply = {
  content: string;
  /** What it did on the way, so the UI can show its work. */
  usedTools: string[];
};

type OpenAiToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type OpenAiMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
};

function systemPrompt(org: Org, member: OrgMember): string {
  const name = org.display_name ?? org.name;
  return [
    `You are the billing assistant for ${name}, working directly inside their dashboard.`,
    `You are talking to ${member.display_name ?? member.email}.`,
    "",
    "House rules:",
    `- Payment terms are ${org.terms_days} days and dates are in ${org.timezone}.`,
    "  Resolve anything relative (yesterday, last Tuesday, the 20th) with the `today`",
    "  tool. Never work a date out from your own clock.",
    "- Ask before deleting an invoice, every time. Cancelling keeps the record and",
    "  its number and is usually what the person means.",
    "- Never invent a service date. It is the day the work was done, often not the",
    "  invoice date. If you do not know it, ask.",
    "- There are no partial payments: unpaid, paid or cancelled.",
    "- `list_clients` gives you the client id, the issuer id and the agreed rate in",
    "  one call, which is everything `create_invoice` needs. Look before you write.",
    "",
    "Answer in the language the person writes in. Be brief: amounts, names and",
    "dates, not paragraphs. When you have changed something, say plainly what",
    "changed. If a tool refuses, tell them what it said rather than trying again",
    "a different way.",
  ].join("\n");
}

/** The registry, in the shape OpenAI wants. One source, two audiences. */
function toolDefinitions() {
  return Object.entries(tools).map(([name, def]) => ({
    type: "function" as const,
    function: {
      name,
      description: def.description,
      parameters: def.schema ?? { type: "object", properties: {} },
    },
  }));
}

async function callOpenAi(
  messages: OpenAiMessage[],
  apiKey: string,
): Promise<OpenAiMessage> {
  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      tools: toolDefinitions(),
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // The key and the org id could both be in here; keep it to the status.
    throw new Error(
      `The assistant is unavailable right now (${res.status}). ${
        detail.includes("model") ? "The configured model was rejected." : ""
      }`.trim(),
    );
  }

  const body = await res.json();
  const message = body.choices?.[0]?.message;
  if (!message) throw new Error("The assistant returned nothing.");
  return message as OpenAiMessage;
}

/**
 * One turn: the person's messages in, the assistant's answer out, with any
 * tool calls executed in between.
 */
export async function runAssistant(
  history: ChatMessage[],
  ctx: ToolContext,
  org: Org,
  member: OrgMember,
): Promise<AssistantReply> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "The assistant is not configured on this deployment (no OPENAI_API_KEY).",
    );
  }

  const messages: OpenAiMessage[] = [
    { role: "system", content: systemPrompt(org, member) },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  const usedTools: string[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const reply = await callOpenAi(messages, apiKey);
    messages.push(reply);

    const calls = reply.tool_calls ?? [];
    if (calls.length === 0) {
      return { content: reply.content ?? "", usedTools };
    }

    for (const call of calls) {
      const def = tools[call.function.name];
      usedTools.push(call.function.name);

      let result: string;
      if (!def) {
        result = JSON.stringify({ error: `No such tool: ${call.function.name}` });
      } else {
        try {
          const args = call.function.arguments
            ? JSON.parse(call.function.arguments)
            : {};
          // The same handler an agent key would reach, with the same org.
          result = JSON.stringify(await def.handler(args, ctx));
        } catch (e) {
          // A refusal is information, not a crash: hand it back so the
          // assistant can explain it instead of retrying blindly.
          result = JSON.stringify({
            error: e instanceof Error ? e.message : "The tool failed.",
          });
        }
      }

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result,
      });
    }
  }

  return {
    content:
      "That turned into more steps than I can take in one go. Ask me for one piece of it and we will get there.",
    usedTools,
  };
}
