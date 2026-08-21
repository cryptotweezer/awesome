"use client";

import { useState } from "react";

/**
 * The whole OAuth connection, as something to copy.
 *
 * Deliberately one command per assistant and nothing else: no key to generate
 * first, no file to download, no placeholder to substitute. The assistant
 * discovers where to authorise on its own and opens the browser, which is the
 * entire reason this path exists.
 *
 * The last option is the one that keeps this honest. Naming three assistants
 * reads as a list of the assistants that work, and there are dozens: Cursor,
 * Gemini, Copilot, whatever ships next month. What the app actually requires
 * is an address and a transport, so the generic case says exactly that and is
 * a tab like the others rather than a footnote under them.
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
  {
    id: "other",
    name: "Any other AI",
    // The address alone, because that is what every other client's form asks
    // for: a name and a URL.
    line: (base: string) => `${base}/api/mcp`,
    note: "Add this as an MCP server over HTTP (some apps call it Streamable HTTP or a remote server), with NO authorisation header. It will send you here to approve it. If it wants a config file instead of a form, use the JSON on the Claude Desktop tab: it is the same thing.",
  },
] as const;

/**
 * The one thing that genuinely works everywhere: not a command, a request.
 *
 * There is no universal `mcp add`. Every CLI ships its own binary and the
 * desktop apps have no command at all, so any single line printed here is
 * wrong for most readers. What every capable assistant CAN do is add a server
 * to its own configuration when told the address and the transport, which
 * makes the portable artefact a short prompt rather than a shell command.
 *
 * Written as instructions to the assistant, not about it, because that is how
 * it will be pasted.
 */
function connectPrompt(base: string, server: string): string {
  return [
    `Connect yourself to my billing app. It is an MCP server:`,
    ``,
    `  name:      ${server}`,
    `  url:       ${base}/api/mcp`,
    `  transport: HTTP (also called Streamable HTTP, or a remote server)`,
    `  auth:      OAuth. No API key, no headers.`,
    ``,
    `Add it to your own MCP configuration, then authorise it: you will be given`,
    `a link to open, and I approve it in my browser. Tell me if you need to be`,
    `restarted before it shows up.`,
    ``,
    `Once you are connected, call the get_started tool before anything else. It`,
    `explains the business and the rules you have to follow.`,
  ].join("\n");
}

export function ConnectCommand({
  baseUrl,
  server,
}: {
  baseUrl: string;
  server: string;
}) {
  const [active, setActive] = useState<string>(CLIENTS[0].id);
  const [manual, setManual] = useState(false);
  const client = CLIENTS.find((c) => c.id === active) ?? CLIENTS[0];
  const text = client.line(baseUrl, server);

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Paste this to your AI
      </p>
      <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        Whichever one you use. It connects itself and sends you back here to
        approve it.
      </p>

      <CopyBox text={connectPrompt(baseUrl, server)} />

      <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        Then approve it in the browser and ask it{" "}
        <span className="font-medium text-slate-700 dark:text-slate-300">
          &ldquo;what am I owed?&rdquo;
        </span>{" "}
        to check. It reads how this business works by itself the first time, so
        there is nothing to install.
      </p>

      <button
        onClick={() => setManual((m) => !m)}
        className="mt-4 text-xs font-medium text-slate-600 underline underline-offset-2 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
      >
        {manual ? "Hide" : "Or add it yourself, by hand"}
      </button>

      {manual && (
        <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-800">
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

      <CopyBox text={text} />

      <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        {client.note}
      </p>
        </div>
      )}
    </div>
  );
}

/** A block of text with its own Copy button. Two of these on the page. */
function CopyBox({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

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
    <div className="mt-3 flex items-start gap-3 rounded-xl bg-slate-950 p-4">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-slate-100">
        {text}
      </code>
      <button
        onClick={copy}
        className="shrink-0 rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 transition hover:bg-slate-700"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
