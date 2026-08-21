// Nothing on the server calls a function that lives in a client file.
//
//   node --test tests/client-boundary.test.mjs
//
// This reads source, not the database: no keys, no network, nothing to clean
// up. It exists because of a 500 that shipped: a plain helper was exported
// from a "use client" component and imported by two server pages. The build
// passed, the types passed, and both pages died on the first request with
// "Attempted to call serverName() from the server but serverName is on the
// client".
//
// That is the whole failure mode. A React component crossing the boundary is
// normal and correct; anything else is a reference the server cannot invoke.
// So the rule enforced here is narrow: a module without "use client" may
// import Components (PascalCase) and types from a client module, and nothing
// else.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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

const isClientModule = (source) => /^\s*["']use client["']/m.test(source);

/** Resolve an import specifier to a file under src, or null if it is a package. */
function resolve(fromFile, spec) {
  const base = spec.startsWith("@/")
    ? path.join(SRC, spec.slice(2))
    : spec.startsWith(".")
      ? path.resolve(path.dirname(fromFile), spec)
      : null;
  if (!base) return null;
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Named imports, with `type` ones dropped: a type never exists at runtime. */
function namedImports(source) {
  const found = [];
  const pattern = /import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const names = match[1]
      .split(",")
      .map((n) => n.trim())
      .filter((n) => n && !n.startsWith("type "))
      .map((n) => n.split(/\s+as\s+/)[0].trim());
    found.push({
      spec: match[2],
      names,
      line: source.slice(0, match.index).split("\n").length,
    });
  }
  return found;
}

const isComponent = (name) => /^[A-Z]/.test(name);

describe("the client boundary", () => {
  const files = sourceFiles(SRC);

  test("there is source to scan", () => {
    assert.ok(files.length > 0, "found no TypeScript under src");
  });

  test("no server module imports a callable from a client module", () => {
    const offenders = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (isClientModule(source)) continue;

      for (const { spec, names, line } of namedImports(source)) {
        const target = resolve(file, spec);
        if (!target) continue;
        if (!isClientModule(readFileSync(target, "utf8"))) continue;

        for (const name of names) {
          if (isComponent(name)) continue;
          const relative = path.relative(SRC, file).replaceAll("\\", "/");
          offenders.push(`${relative}:${line}  imports ${name} from "${spec}"`);
        }
      }
    }

    assert.deepEqual(
      offenders,
      [],
      `\n\nValues imported from a "use client" module into server code:\n\n` +
        offenders.join("\n") +
        `\n\nOn the server these are client references, not functions, and ` +
        `calling one is a 500 at request time that no build catches. Move the ` +
        `helper into a module with no "use client" and import it from there.\n`,
    );
  });
});
