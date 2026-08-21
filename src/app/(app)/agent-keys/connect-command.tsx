"use client";

import { useState } from "react";

/**
 * The whole OAuth connection, as something to copy.
 *
 * Deliberately one command per assistant and nothing else: no key to generate
 * first, no file to download, no placeholder to substitute. The assistant
 * discovers where to authorise on its own and opens the browser, which is the
 * entire reason this path exists.
 */
const CLIENTS = [
  {
    id: "claude-code",
    name: "Claude Code",
    line: (base: string, server: string) =>
      `claude mcp add --transport http ${server} ${base}/api/mcp --scope user`,
    // The order matters and getting it wrong looks like a broken app: Claude
    // Code reads its MCP list at startup, so /mcp does not show this server
    // until it has been restarted once.
    note: "Run it, restart Claude Code, then say /mcp and pick this server to authorise.",
  },
  {
    id: "codex",
    name: "Codex",
    line: (base: string, server: string) =>
      `codex mcp add ${server} --transport http --url ${base}/api/mcp`,
    note: "Codex opens the browser the first time it calls a tool. Restart it after connecting.",
  },
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    line: (base: string, server: string) =>
      `{ "mcpServers": { "${server}": { "type": "http", "url": "${base}/api/mcp" } } }`,
    note: "Settings, Developer, Edit config. Paste inside the existing block, save, then quit and reopen Claude Desktop.",
  },
] as const;

/**
 * The name the MCP server gets in the person's own config. Lowercase and with
 * no spaces, because it is typed on a command line, and named after their
 * business so that somebody connected to two of these can tell them apart.
 */
export function serverName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "billing"
  );
}

export function ConnectCommand({
  baseUrl,
  server,
}: {
  baseUrl: string;
  server: string;
}) {
  const [active, setActive] = useState<string>(CLIENTS[0].id);
  const [copied, setCopied] = useState(false);
  const client = CLIENTS.find((c) => c.id === active) ?? CLIENTS[0];
  const text = client.line(baseUrl, server);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Which assistant are you connecting?
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {CLIENTS.map((c) => (
          <button
            key={c.id}
            onClick={() => setActive(c.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              c.id === active
                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-start gap-3 rounded-xl bg-slate-950 p-4">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-slate-100">
          {text}
        </code>
        <button
          onClick={copy}
          className="shrink-0 rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 transition hover:bg-slate-700"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        {client.note}
      </p>

      <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        Any assistant that speaks MCP can connect, not only these three. If yours
        is not listed, point it at{" "}
        <span className="font-mono text-slate-700 dark:text-slate-300">
          {baseUrl}/api/mcp
        </span>{" "}
        as an HTTP MCP server with no header, and it will ask you to approve it
        here.
      </p>

      <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        Once it is connected, ask it{" "}
        <span className="font-medium text-slate-700 dark:text-slate-300">
          &ldquo;what am I owed?&rdquo;
        </span>{" "}
        to check. It reads how this business works by itself the first time, so
        there is nothing to install.
      </p>
    </div>
  );
}
