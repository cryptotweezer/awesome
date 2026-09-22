// The savings plan is Awesome's, and the code has to say so in every place it
// could leak.
//
//   node --test tests/savings-gate.test.mjs
//
// This reads source, not the database. It exists because the leak would be
// quiet: a guest business would see a screen, or an agent would be handed a
// tool list with things on it their key cannot reach, and nobody would find out
// until somebody tried. Four gates, and every one of them has to be there:
//
//   1. every /savings page resolves its org through awesomeForPage()
//   2. every server action behind those pages checks the org itself, because a
//      server action is a public endpoint and the page's check does not cover it
//   3. the tool registry is built per business, not imported flat
//   4. the agent briefing mentions the savings tools only for Awesome
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const SAVINGS = path.join(SRC, "app", "(savings)");

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const rel = (f) => path.relative(SRC, f).replaceAll("\\", "/");

describe("the savings section belongs to Awesome alone", () => {
  const files = sourceFiles(SAVINGS);

  test("there is a savings section to check", () => {
    assert.ok(files.length > 0, "found no source under src/app/(savings)");
  });

  test("every page resolves its business through the gate", () => {
    const offenders = [];
    for (const file of files) {
      if (path.basename(file) !== "page.tsx") continue;
      const source = readFileSync(file, "utf8");
      // A page that only redirects elsewhere reaches nothing and needs no gate;
      // the page it sends you to has one.
      if (/^\s*redirect\(/m.test(source) && !/await\s+\w+\(/.test(source)) {
        continue;
      }
      if (!source.includes("awesomeForPage()")) offenders.push(rel(file));
    }

    assert.deepEqual(
      offenders,
      [],
      `\n\nSavings pages that do not call awesomeForPage():\n\n` +
        offenders.join("\n") +
        `\n\nWithout it a guest business that types the URL gets Awesome's ` +
        `screen. orgForPage() is not enough: it answers "which business", not ` +
        `"may this business be here".\n`,
    );
  });

  test("every server action checks the business itself", () => {
    const offenders = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (!/^\s*["']use server["']/m.test(source)) continue;
      if (!source.includes("AWESOME_ORG_ID")) offenders.push(rel(file));
    }

    assert.deepEqual(
      offenders,
      [],
      `\n\nSavings server actions with no check of their own:\n\n` +
        offenders.join("\n") +
        `\n\nA server action is a public endpoint. The page's gate does not ` +
        `cover it: anybody signed in can post to one directly.\n`,
    );
  });

  test("the tool registry is built per business", () => {
    const toolsFile = readFileSync(
      path.join(SRC, "lib", "gateway", "tools.ts"),
      "utf8",
    );
    assert.match(
      toolsFile,
      /export async function registryFor/,
      "registryFor is gone, so every business would get the same tool list",
    );

    // The two places the MCP transport decides what exists.
    const mcp = readFileSync(
      path.join(SRC, "app", "api", "mcp", "route.ts"),
      "utf8",
    );
    const listBuiltFlat = /tools:\s*Object\.entries\(tools\)/.test(mcp);
    assert.equal(
      listBuiltFlat,
      false,
      "tools/list is built from the flat module, so every business would be " +
        "offered Awesome's savings tools",
    );
    assert.match(
      mcp,
      /registryFor\(agent\.orgId\)/,
      "the MCP route no longer builds its registry from the caller's business",
    );

    const rest = readFileSync(
      path.join(SRC, "app", "api", "agent", "[tool]", "route.ts"),
      "utf8",
    );
    assert.match(
      rest,
      /registryFor\(agent\.orgId\)/,
      "the REST route would run a savings tool for any business that guessed the name",
    );

    const chat = readFileSync(
      path.join(SRC, "lib", "chat", "assistant.ts"),
      "utf8",
    );
    assert.match(
      chat,
      /registryFor\(orgId\)/,
      "the dashboard assistant would offer every business the savings tools",
    );
  });

  test("the briefing mentions the savings tools only for Awesome", () => {
    const skill = readFileSync(
      path.join(SRC, "lib", "guest", "skill.ts"),
      "utf8",
    );
    assert.match(
      skill,
      /function savingsSection\(org: Org\): string \{\s*\n\s*if \(org\.id !== AWESOME_ORG_ID\) return "";/,
      "the savings briefing is not gated on the business, so a guest's kit " +
        "would describe tools their key cannot reach",
    );
  });

  test("the savings tools declare a scope, every one of them", () => {
    const source = readFileSync(
      path.join(SRC, "lib", "gateway", "savings-tools.ts"),
      "utf8",
    );
    // Each tool is `name: {` at one indent inside the registry object.
    const names = [...source.matchAll(/^ {2}([a-z_]+): \{$/gm)].map((m) => m[1]);
    assert.ok(names.length >= 10, `only found ${names.length} savings tools`);

    for (const name of names) {
      const start = source.indexOf(`\n  ${name}: {`);
      const body = source.slice(start, start + 400);
      assert.match(
        body,
        /scope: "(read|write|delete)"/,
        `${name} declares no scope. A tool with no scope is not callable, ` +
          `which is the safe failure, but it is still a tool nobody can use.`,
      );
    }
  });
});
