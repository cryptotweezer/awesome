import "server-only";
import { tools, type ToolContext, type ToolDef } from "@/lib/gateway/tools";
import { runTool } from "@/lib/gateway/dispatch";
import { resolveClient, resolveIssuer } from "@/lib/gateway/documents";
import { getInvoiceByRef } from "@/lib/data/invoices";
import { listIssuers } from "@/lib/data/issuers";
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
    // The one arithmetic mistake this assistant kept making: quoting a rate,
    // then a GST figure, then adding the two together into a total that no
    // invoice has ever said. Prices here INCLUDE the tax.
    "- Prices INCLUDE GST. `gst_amount` is the tax already inside `total`, never",
    "  a charge on top of it. An invoice of 150 with 13.64 of GST is 150 to pay,",
    "  not 163.64. Only ever quote the invoice `total` as the amount owed, and",
    "  never add gst_amount to anything.",
    "- A GST figure comes from `gst_position` and from nowhere else. `paid` and",
    "  `billed` in any report are money, not tax: never present one as GST, and",
    "  never work GST out yourself.",
    "",
    "Documents. When they ask you to send, show or email an invoice or a",
    "statement, call the matching link tool (`invoice_pdf_link`,",
    "`client_statement_link`, `tax_statement_link`) and give them the `url` it",
    "returns, copied exactly, on a line of its own. Never write one of these",
    "addresses yourself: the ids are not guessable and a made-up one is a dead",
    "link. Do not open with what you cannot do; hand over the document. A full",
    "backup of the business is at /backup.",
    "",
    // It offered to email a statement, was told to go ahead, and answered that
    // it had. There is no send tool here at all, so the offer was the bug.
    "You have no way to send email. Never offer to send one, never ask whether",
    "they would like it emailed, and never say one has been sent. If they ask",
    "you to email something, say you cannot send mail from the dashboard, and",
    "that the link opens the PDF for them to attach from their own mail.",
    "",
    "Never say you have done something unless a tool in this same turn did it",
    "and answered. If no tool was called, nothing has changed.",
    "",
    "Answer in the language the person writes in. Be brief: amounts, names and",
    "dates, not paragraphs. Write plain text, no Markdown: no **, no ##, no",
    "tables. A short list is one item per line starting with '- '. When you have",
    "changed something, say plainly what changed. If a tool refuses, tell them",
    "what it said rather than trying again a different way.",
  ].join("\n");
}

/**
 * Tools the dashboard assistant does not get.
 *
 * Every one of these answers with a base64 file. An agent with its own Gmail
 * wants those bytes; this conversation cannot do anything with them except
 * carry a megabyte of them back into the next request, which is why asking for
 * a statement here used to hang and then cost a fortune. The person gets a link
 * instead (see the system prompt), which the browser is already signed in for.
 */
const WITHOUT_FILES = new Set([
  "get_invoice_pdf",
  "get_client_statement",
  "get_tax_statement",
  "prepare_client_email",
  "prepare_client_statement_email",
  "create_backup",
]);

/**
 * What replaces them: the same documents, as links the browser can open.
 *
 * These exist only here. An agent elsewhere wants the bytes; a person sitting
 * in front of the dashboard wants something to click, and their session already
 * authorises those routes. They are tools rather than a paragraph of URL
 * templates in the prompt because a model asked to build an address out of a
 * UUID it has not looked up will cheerfully write `/statements/client/1/pdf`.
 */
const linkTools: Record<string, ToolDef> = {
  invoice_pdf_link: {
    scope: "read",
    description:
      "A link to one invoice's PDF, to give to the person. Args: invoice (the invoice number).",
    schema: {
      type: "object",
      required: ["invoice"],
      properties: {
        invoice: { type: "number", description: "The invoice number." },
      },
    },
    handler: async (input, ctx) => {
      const invoice = await getInvoiceByRef(
        ctx.agent.orgId,
        String(input.invoice ?? ""),
      );
      if (!invoice) throw new Error(`Invoice ${input.invoice} not found.`);
      return {
        url: `/invoices/${invoice.invoice_number}/pdf`,
        label: `Invoice ${invoice.invoice_number} for ${invoice.bill_to_name}`,
      };
    },
  },
  client_statement_link: {
    scope: "read",
    description:
      "A link to a client's outstanding-payment statement PDF, to give to the person. Args: client (name) or client_id.",
    schema: {
      type: "object",
      properties: {
        client: { type: "string", description: "Client name, or part of it." },
        client_id: { type: "string", description: "Client UUID." },
      },
    },
    handler: async (input, ctx) => {
      const client = await resolveClient(ctx.agent.orgId, {
        client: typeof input.client === "string" ? input.client : null,
        client_id: typeof input.client_id === "string" ? input.client_id : null,
      });
      return {
        url: `/statements/client/${client.id}/pdf`,
        label: `Statement for ${client.name}`,
      };
    },
  },
  tax_statement_link: {
    scope: "read",
    description:
      "A link to the financial-year tax statement PDF for one ABN. Args: issuer? (short name; omit when the business has one ABN), fy_start? (YYYY-07-01, defaults to the current FY).",
    schema: {
      type: "object",
      properties: {
        issuer: { type: "string", description: "Issuer short name." },
        issuer_id: { type: "string", description: "Issuer UUID." },
        fy_start: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          description: "Start of the financial year. Defaults to the current one.",
        },
      },
    },
    handler: async (input, ctx) => {
      const named =
        typeof input.issuer === "string" || typeof input.issuer_id === "string";
      // "My financial year statement" names no ABN, and most businesses have
      // exactly one. Only ask when there is genuinely something to choose.
      const issuer = named
        ? await resolveIssuer(ctx.agent.orgId, {
            issuer: typeof input.issuer === "string" ? input.issuer : null,
            issuer_id:
              typeof input.issuer_id === "string" ? input.issuer_id : null,
          })
        : await (async () => {
            const all = await listIssuers(ctx.agent.orgId);
            if (all.length === 1) return all[0];
            if (all.length === 0) throw new Error("This business has no ABN yet.");
            throw new Error(
              `Which ABN? ${all.map((i) => i.short_name).join(", ")}.`,
            );
          })();
      const fy = typeof input.fy_start === "string" ? input.fy_start : null;
      return {
        url: `/statements/fy/${issuer.id}/pdf${fy ? `?fy=${fy}` : ""}`,
        label: `Tax statement for ${issuer.short_name}`,
      };
    },
  },
};

const chatTools: Record<string, ToolDef> = {
  ...Object.fromEntries(
    Object.entries(tools).filter(([name]) => !WITHOUT_FILES.has(name)),
  ),
  ...linkTools,
};

/** The registry, in the shape OpenAI wants. One source, two audiences. */
function toolDefinitions() {
  return Object.entries(chatTools).map(([name, def]) => ({
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
    // The person is told only the status; the reason belongs in the log, where
    // it is the difference between a two-minute fix and an afternoon of
    // guessing at 502s.
    console.error("[assistant] OpenAI", res.status, detail.slice(0, 2000));
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
      const def = chatTools[call.function.name];
      usedTools.push(call.function.name);

      let result: string;
      if (WITHOUT_FILES.has(call.function.name)) {
        result = JSON.stringify({
          error:
            "Files cannot be handed over in this chat. Give the person the link for the document instead, as described in your instructions.",
        });
      } else if (!def) {
        result = JSON.stringify({ error: `No such tool: ${call.function.name}` });
      } else {
        let args: Record<string, unknown> = {};
        try {
          args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          args = {};
        }
        // The same dispatcher an agent key would reach, with the same org, so
        // this assistant is logged and guarded exactly like anything else that
        // acts on the business. `?? { ok: true }` because a handler that
        // answers with nothing would serialise to no content at all, and a
        // tool message without content is rejected by the chat API: the write
        // lands and the turn 502s.
        const outcome = await runTool(call.function.name, args, ctx.agent, {
          registry: chatTools,
        });
        // A refusal is information, not a crash: hand it back so the assistant
        // can explain it instead of retrying blindly.
        result = outcome.ok
          ? JSON.stringify(outcome.result ?? { ok: true })
          : JSON.stringify({ error: outcome.error });
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
