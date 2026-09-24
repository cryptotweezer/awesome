// What an agent key can reach, and nothing more.
//
//   node --env-file=<keys.env> --test tests/gateway-surface.test.mjs
//
// This Supabase project also holds the `resume` and `pis` schemas, which belong
// to other products of the same owner. An agent key handed to a stranger's
// Claude must never become a way in. Three things keep that true, and this file
// asserts all three so a future change cannot quietly undo them:
//
//   1. The gateway dispatches ONLY to a fixed registry of named tools.
//   2. No tool takes a schema or a table name, so nothing outside `awesome` is
//      addressable in the first place.
//   3. The data client is pinned to `db: { schema: "awesome" }`.
//
// The tool allowlist below is deliberately hardcoded. Adding a tool has to be a
// deliberate act that updates this list, rather than something that slips in.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const BASE = process.env.AWESOME_BASE_URL ?? "http://localhost:3000";
// A: organisation #1, which has the savings plan. B: a throwaway business, which
// stands for every guest and must never be offered a savings tool.
const KEY = process.env.AWESOME_KEY_A;
const GUEST_KEY = process.env.AWESOME_KEY_B;
if (!KEY) {
  console.error("Set AWESOME_KEY_A (see scripts/seed-test-org.mjs).");
  process.exit(1);
}

/** What EVERY business gets: the billing app and the gateway's own tools. */
const BILLING_TOOLS = [
  "billed_in_period",
  "business_snapshot",
  "cancel_invoice",
  "client_account",
  "client_summary",
  "create_backup",
  "create_client",
  "create_invoice",
  "delete_client",
  "delete_invoice",
  "find_invoices",
  "fy_summary",
  "get_client_statement",
  "get_invoice",
  "get_invoice_pdf",
  "get_started",
  "get_tax_statement",
  "gst_position",
  "list_clients",
  "list_issuers",
  "mark_paid",
  "mark_unpaid",
  "overdue_invoices",
  "prepare_client_email",
  "prepare_client_statement_email",
  "reactivate_invoice",
  "recent_invoices",
  "today",
  "update_client",
  "update_invoice",
  "who_owes",
];

/**
 * What organisation #1 gets ON TOP of those: the savings plan.
 *
 * Hardcoded for the same reason as the list above, and split in two because the
 * split is the thing worth asserting. A savings tool appearing in a guest's list
 * would be a tool their key cannot use and their data does not have, and an
 * agent told about a tool will try it.
 */
const SAVINGS_TOOLS = [
  // Reading
  "savings_overview",
  "savings_week",
  "savings_weeks",
  "rotation",
  "weekly_expenses",
  "loans_status",
  "vault_status",
  // A week as it happens
  "mark_service",
  "record_week_payment",
  "add_week_job",
  "set_week_cost",
  "set_week_notes",
  "close_savings_week",
  "reopen_savings_week",
  "delete_week_job",
  "delete_week_cost",
  // The standing list, the loans, the clients' rhythm
  "set_weekly_expense",
  "archive_weekly_expense",
  "delete_weekly_expense",
  "set_loan",
  "archive_loan",
  "delete_loan",
  "record_loan_payment",
  "delete_loan_payment",
  "set_client_rhythm",
  // The vault
  "send_to_vault_col",
  "record_vault_withdrawal",
  "record_vault_deposit",
  "delete_vault_movement",
  // The plan itself: only what an agent may change. Creating, archiving and
  // deleting a plan is the owner's, in the dashboard, on purpose.
  "update_savings_plan",
];

const EXPECTED_TOOLS = [...BILLING_TOOLS, ...SAVINGS_TOOLS].sort();

async function rest(tool, input = {}) {
  const res = await fetch(`${BASE}/api/agent/${tool}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function mcp(method, params = {}, key = KEY) {
  const res = await fetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return res.json();
}

describe("the gateway exposes exactly the tools it means to", () => {
  test("MCP tools/list matches the allowlist", async () => {
    const res = await mcp("tools/list");
    const names = res.result.tools.map((t) => t.name).sort();
    assert.deepEqual(
      names,
      EXPECTED_TOOLS,
      "the tool registry changed. If that was deliberate, update EXPECTED_TOOLS " +
        "after checking the new tool cannot address another schema.",
    );
  });

  test("a business without a savings plan is offered none of its tools", async () => {
    if (!GUEST_KEY) {
      console.error("Set AWESOME_KEY_B to check the guest side of the split.");
      return;
    }
    const res = await mcp("tools/list", {}, GUEST_KEY);
    const names = res.result.tools.map((t) => t.name).sort();
    assert.deepEqual(
      names,
      [...BILLING_TOOLS].sort(),
      "a business with no savings plan was offered savings tools, or lost a " +
        "billing one. The registry is built per business by registryFor().",
    );
  });

  test("every tool declares an object schema", async () => {
    // The same registry is handed to the dashboard assistant as OpenAI
    // function definitions, and `parameters` there must be an object schema.
    // A tool that forgets one would break the assistant, not just MCP.
    const res = await mcp("tools/list");
    for (const tool of res.result.tools) {
      assert.equal(
        tool.inputSchema?.type,
        "object",
        `${tool.name} does not declare an object schema`,
      );
    }
  });

  test("no tool declares a schema, table or query argument", async () => {
    const res = await mcp("tools/list");
    for (const tool of res.result.tools) {
      const keys = Object.keys(tool.inputSchema?.properties ?? {});
      for (const forbidden of ["schema", "table", "sql", "query", "database"]) {
        assert.ok(
          !keys.includes(forbidden),
          `${tool.name} accepts "${forbidden}", which could point outside the awesome schema`,
        );
      }
    }
  });
});

describe("nothing outside the registry is reachable", () => {
  const notTools = [
    "execute_sql",
    "query",
    "sql",
    "list_tables",
    "select",
    "projects",
    "project_notes",
  ];

  for (const name of notTools) {
    test(`${name} is not a tool`, async () => {
      const { status } = await rest(name);
      assert.equal(status, 404, `${name} answered instead of 404`);
    });
  }

  test("extra arguments naming another schema are ignored, not honoured", async () => {
    const { status, body } = await rest("list_clients", {
      schema: "pis",
      table: "projects",
      sql: "select * from pis.projects",
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    const text = JSON.stringify(body.result);
    for (const marker of ["project_notes", "dash_skills", "guest_limits", "pis."]) {
      assert.ok(!text.includes(marker), `response mentions ${marker}`);
    }
  });
});

describe("the data client stays pinned to the awesome schema", () => {
  test("createAdminClient names no other schema", () => {
    const file = path.join(process.cwd(), "src", "lib", "supabase", "admin.ts");
    const source = readFileSync(file, "utf8");
    assert.match(
      source,
      /schema:\s*"awesome"/,
      "admin.ts no longer pins the schema to awesome",
    );
    for (const other of ["resume", "pis"]) {
      assert.ok(
        !new RegExp(`schema:\\s*"${other}"`).test(source),
        `admin.ts mentions the ${other} schema`,
      );
    }
  });
});
