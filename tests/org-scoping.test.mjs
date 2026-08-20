// Every query names its business.
//
//   node --test tests/org-scoping.test.mjs
//
// This reads source, not the database: no keys, no network, nothing to clean
// up. It exists because of how the isolation between businesses is built.
//
// RLS is on with no policies, so every read and write goes through the
// service_role client, which sees all seven tables in full. The only thing
// keeping one business out of another's data is that each query carries the
// org it is for. There is no second barrier underneath: a single query written
// without `org_id` is not a smaller leak, it is the whole table.
//
// That invariant is easy to hold when writing a file and easy to forget three
// months later, so this test holds it instead. It scans every Supabase query
// builder in the codebase and fails on any that does not name a business.
//
// The exceptions below are the queries that legitimately cannot: the ones that
// are working out WHICH business the caller belongs to. They are listed one by
// one, with the reason, because an exception nobody had to justify is how this
// kind of check quietly stops meaning anything.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");

/**
 * The tables that hold one business's data. Every row in them has an org_id,
 * so every query against them must say which org it means.
 */
const SCOPED = [
  "org_members",
  "issuers",
  "clients",
  "invoices",
  "invoice_items",
  "agent_keys",
  // OAuth connections and the consents that produced them. `oauth_clients` is
  // deliberately absent: a registered client is global, has no org_id, and is
  // just a name shown on a consent screen.
  "oauth_tokens",
  "oauth_codes",
];

/**
 * `orgs` is the businesses themselves: the org is the row, so `id` is what
 * scopes it rather than `org_id`.
 */
const ORG_TABLE = "orgs";

/**
 * Queries that resolve identity, and so run before there is an org to name.
 * Keyed by "file:table", with what makes each one safe.
 */
const EXCEPTIONS = {
  // The session's membership, looked up by the Supabase user id from the
  // cookie. This IS the lookup that produces the org for everything else.
  "lib/data/org.ts:org_members": "resolves the org from the signed-in user",
  // The key's row, looked up by the hash of the presented secret. This is the
  // lookup that produces the org for every gateway request.
  "lib/gateway/auth.ts:agent_keys": "resolves the org from the presented key",
  // The OAuth equivalents. This file exists ONLY to turn a presented secret
  // into an identity, which is why it is exempt and why nothing else in
  // lib/oauth is: every query there looks a row up by the hash of the secret
  // the caller sent, and none of them accepts an org, a user or a row id.
  "lib/oauth/credentials.ts:oauth_tokens":
    "resolves the org from the presented access or refresh token",
  "lib/oauth/credentials.ts:oauth_codes":
    "resolves the org from the single-use code the browser brought back",
};

/** Every .ts / .tsx file under src. */
function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Pull out every `.from("table")` query builder and the chain that follows it.
 *
 * The chain is taken up to the end of the statement, or to the next `.from(`,
 * whichever comes first. The second bound matters: two queries often sit in one
 * `Promise.all([...])` statement, and without it a scoped query would vouch for
 * an unscoped one sitting beside it.
 */
function queries(source) {
  const found = [];
  const pattern = /\.from\("([a-z_]+)"\)/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const start = match.index;
    const rest = source.slice(start + match[0].length);
    const semicolon = rest.indexOf(";");
    const nextFrom = rest.indexOf('.from("');
    const ends = [semicolon, nextFrom].filter((i) => i !== -1);
    const end = ends.length ? Math.min(...ends) : rest.length;
    found.push({
      table: match[1],
      chain: rest.slice(0, end),
      line: source.slice(0, start).split("\n").length,
    });
  }
  return found;
}

/** Where in the chain a business is named. */
function namesAnOrg(table, chain) {
  if (table === ORG_TABLE) {
    // Either a lookup of one org by its id, or a filter on org id.
    return /\.eq\("id",/.test(chain) || /org_id/.test(chain);
  }
  // A filter for reads, updates and deletes; a column for inserts.
  return /org_id/.test(chain);
}

describe("org scoping", () => {
  const files = sourceFiles(SRC);

  test("there is source to scan", () => {
    assert.ok(files.length > 0, "found no TypeScript under src");
  });

  test("every query against a business table names the business", () => {
    const offenders = [];
    let checked = 0;

    for (const file of files) {
      const relative = path.relative(SRC, file).replaceAll("\\", "/");
      for (const { table, chain, line } of queries(readFileSync(file, "utf8"))) {
        if (table !== ORG_TABLE && !SCOPED.includes(table)) continue;
        if (EXCEPTIONS[`${relative}:${table}`]) continue;
        checked += 1;
        if (!namesAnOrg(table, chain)) {
          offenders.push(`${relative}:${line}  .from("${table}") has no org_id`);
        }
      }
    }

    // A scan that silently matched nothing would pass forever. If this trips,
    // the pattern in queries() has stopped fitting how the queries are written.
    assert.ok(
      checked > 30,
      `only ${checked} queries were checked, the scan is not seeing the code`,
    );

    assert.deepEqual(
      offenders,
      [],
      `\n\nQueries that could read or write another business's data:\n\n` +
        offenders.join("\n") +
        `\n\nAdd .eq("org_id", orgId) (or org_id in the inserted row). If the ` +
        `query genuinely runs before the org is known, add it to EXCEPTIONS ` +
        `in this file with the reason.\n`,
    );
  });

  test("every exception still points at a real query", () => {
    const stale = [];
    for (const key of Object.keys(EXCEPTIONS)) {
      const [relative, table] = key.split(":");
      const full = path.join(SRC, relative);
      let source;
      try {
        source = readFileSync(full, "utf8");
      } catch {
        stale.push(`${key}  (file is gone)`);
        continue;
      }
      if (!queries(source).some((q) => q.table === table)) {
        stale.push(`${key}  (no longer queries that table)`);
      }
    }
    assert.deepEqual(
      stale,
      [],
      `\n\nExceptions that no longer describe anything:\n\n${stale.join("\n")}\n\n` +
        `Remove them, so the list stays the short list of queries that really ` +
        `cannot name an org.\n`,
    );
  });
});
