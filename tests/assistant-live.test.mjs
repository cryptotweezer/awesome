// The one part of the assistant that cannot be tested without money: the model.
//
//   node --env-file=.env.local --env-file=<keys.env> --test tests/assistant-live.test.mjs
//
// It costs a few cents to run, so it is not part of the normal suite. What it
// proves is the pair of things that no amount of local checking can:
//
//   1. OpenAI ACCEPTS our tool schemas. They were written for MCP, and MCP is
//      more forgiving: a schema OpenAI rejects would fail only here.
//   2. The configured model exists and answers.
//
// It mirrors what src/lib/chat/assistant.ts does rather than importing it,
// because that file is TypeScript and server-only. If the two ever drift, this
// stops proving anything, so keep the shape in step.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.AWESOME_BASE_URL ?? "http://localhost:3000";
const KEY = process.env.AWESOME_KEY_A;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini";

if (!KEY || !OPENAI_KEY) {
  console.error(
    "Needs AWESOME_KEY_A (scripts/seed-test-org.mjs) and OPENAI_API_KEY (.env.local).",
  );
  process.exit(1);
}

async function gateway(tool, input = {}) {
  const res = await fetch(`${BASE}/api/agent/${tool}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify(input),
  });
  return res.json();
}

async function openai(messages, tools) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({ model: MODEL, messages, tools, temperature: 0.2 }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(
      `OpenAI ${res.status}: ${body?.error?.message ?? "unknown error"}`,
    );
  }
  return body.choices[0].message;
}

let toolDefs = [];

before(async () => {
  const res = await fetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const body = await res.json();
  toolDefs = body.result.tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
  assert.ok(toolDefs.length > 20, "the tool list came back short");
});

describe("the model can be reached with our tools", () => {
  test("OpenAI accepts every tool schema we publish", async () => {
    // Any malformed schema is rejected at request validation, before the model
    // is even consulted, so this one call checks all of them at once.
    const reply = await openai(
      [{ role: "user", content: "Say the single word: ready." }],
      toolDefs,
    );
    assert.ok(reply, "no reply from the model");
  });

  test("it calls a tool and answers from the result", async () => {
    const messages = [
      {
        role: "system",
        content:
          "You are a billing assistant. Use the tools for anything about money. Be brief.",
      },
      { role: "user", content: "What am I owed in total right now?" },
    ];

    const first = await openai(messages, toolDefs);
    assert.ok(
      first.tool_calls?.length,
      "the model answered about money without consulting the data",
    );
    messages.push(first);

    for (const call of first.tool_calls) {
      const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      const result = await gateway(call.function.name, args);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }

    const second = await openai(messages, toolDefs);
    assert.ok(second.content, "the model produced no answer after the tool call");

    // The truth, straight from the gateway, has to appear in what it said.
    const snapshot = await gateway("business_snapshot");
    const owed = Math.round(Number(snapshot.result.outstanding_amount));
    assert.ok(
      second.content.includes(String(owed)),
      `the answer does not mention the real outstanding amount (${owed}): ${second.content}`,
    );
  });
});
