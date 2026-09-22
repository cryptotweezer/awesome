// A cash client is never invoiced, and nothing may quietly undo that.
//
//   node --test tests/cash-clients.test.mjs
//
// Awesome works for two kinds of client. One is invoiced, appears in the
// history and on documents, and is what this app was originally for. The other
// pays in person, is never sent anything, and exists only so the savings plan
// knows what money should come in. They share a table, because they are both
// clients and splitting them would make every savings record point at one of
// two possible parents.
//
// Sharing a table means the separation has to be kept somewhere, and there are
// exactly two places: the pages that lead to an invoice ask for invoiceable
// clients only, and Postgres refuses to bill a cash one. The second is the
// guarantee and the first is a convenience, so this test cares more about the
// second. It reads source, not the database: no keys, no network.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** The call's arguments, from `listClients(` to its matching bracket. */
function listClientsCalls(source) {
  const calls = [];
  const pattern = /listClients\(/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    let depth = 0;
    let i = match.index + match[0].length - 1;
    for (; i < source.length; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")" && --depth === 0) break;
    }
    calls.push({
      args: source.slice(match.index + match[0].length, i),
      line: source.slice(0, match.index).split("\n").length,
    });
  }
  return calls;
}

describe("cash clients never reach invoicing", () => {
  test("every page that raises or edits an invoice asks for invoiceable clients", () => {
    const offenders = [];
    for (const file of sourceFiles(SRC)) {
      const relative = path.relative(SRC, file).replaceAll("\\", "/");
      // Only the pages behind an invoice form. The client list and the savings
      // dashboard are supposed to see everybody.
      if (!relative.includes("/invoices/")) continue;

      const source = readFileSync(file, "utf8");
      for (const { args, line } of listClientsCalls(source)) {
        if (/invoiceable\s*:\s*true/.test(args)) continue;
        offenders.push(`${relative}:${line}  listClients(${args.trim()})`);
      }
    }

    assert.deepEqual(
      offenders,
      [],
      `\n\nAn invoice form is being offered every client, cash ones included:\n\n` +
        offenders.join("\n") +
        `\n\nPass { invoiceable: true }. Postgres will still refuse the invoice, ` +
        `but offering a name that cannot be billed is a dead end the person only ` +
        `finds at the end of filling in the form.\n`,
    );
  });

  test("Postgres refuses to invoice a cash client", () => {
    const schema = readFileSync(path.join(ROOT, "supabase", "schema.sql"), "utf8");

    assert.match(
      schema,
      /create or replace function awesome\.assert_invoiceable/,
      "assert_invoiceable is gone from schema.sql, which is the authoritative " +
        "description of the database. Without it nothing stops an agent billing " +
        "a client who is never invoiced.",
    );

    // The check has to be inside each function, not merely defined somewhere.
    for (const fn of ["create_invoice", "update_invoice"]) {
      const start = schema.indexOf(`create or replace function awesome.${fn}(`);
      assert.ok(start > -1, `${fn} is missing from schema.sql`);
      const end = schema.indexOf("\n$$;", start);
      const body = schema.slice(start, end);
      assert.match(
        body,
        /perform awesome\.assert_invoiceable\(v_client\);/,
        `${fn} no longer calls assert_invoiceable. A migration that recreates ` +
          `this function has to carry the check with it: the body IS the ` +
          `definition, so dropping a line here silently reopens billing to cash ` +
          `clients for every caller at once.`,
      );
    }
  });

  test("the accountant's workbook holds only the billed side", () => {
    const excel = readFileSync(
      path.join(SRC, "lib", "data", "backup-excel.ts"),
      "utf8",
    );
    assert.match(
      excel,
      /billing_type === "invoice"/,
      "The Excel backup goes to the accountant, so it carries invoiced clients " +
        "and nothing else: not cash, and not the ones who transfer without ever " +
        "being invoiced. The JSON backup is the complete copy.",
    );
  });
});
