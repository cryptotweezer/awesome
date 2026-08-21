import "server-only";
import type { Issuer, Org } from "@/lib/types";

/**
 * The install kit a business downloads to teach its own AI how to bill.
 *
 * Everything here is generated per organisation and carries that
 * organisation's agent key, so the person downloading it can unzip, drop the
 * folder in place and be done. That also means the file holds a secret, which
 * the page it comes from has to say out loud.
 *
 * The tool names must match src/lib/gateway/tools.ts. They are listed by hand
 * rather than generated from the registry because the descriptions here are
 * written for the person's agent, not for a schema.
 */

export type SkillContext = {
  org: Org;
  issuer: Issuer | null;
  /** The raw agent key. Known only in the request that minted it. */
  key: string;
  /** Where the gateway lives, e.g. https://awesome.andreshenao.com.au */
  baseUrl: string;
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "my-business";

export function skillFolderName(org: Org): string {
  return `${slug(org.display_name ?? org.name)}-billing`;
}

/**
 * What the MCP connection is called in the person's assistant.
 *
 * Named after the business, not after this app. Every kit used to say
 * "awesome", so a bookkeeper with two clients could not install the second kit
 * without overwriting the first, and the tools of one business would answer
 * for the other.
 */
export function mcpServerName(org: Org): string {
  return slug(org.display_name ?? org.name);
}

/** The trial ceilings, said plainly, or nothing when the account has none. */
function limitsSection(org: Org): string {
  if (!org.is_demo) return "";
  const caps = [
    org.max_clients ? `**${org.max_clients} clients**` : null,
    org.max_invoices ? `**${org.max_invoices} invoices**` : null,
  ].filter(Boolean);
  if (caps.length === 0) return "";
  return `
## What this account can hold

It is a trial, so it stops at ${caps.join(" and ")}. Past that the app refuses
the write and says so; nothing breaks, and deleting something frees the space
again. There is no limit on how much you and I talk: the allowance the
dashboard mentions is for the little assistant built into the web app, which
runs on the app owner's account. You are the user's own AI, and every call you
make here is free of that.
`;
}

/**
 * The guidance itself: what this business is, the rules, the tools, how to
 * work. Exported because the `get_started` gateway tool serves exactly this,
 * so an assistant that connected over OAuth learns the same thing without
 * downloading anything. One source, so the kit and the tool cannot drift.
 */
export function guidanceMarkdown({
  org,
  issuer,
}: Pick<SkillContext, "org" | "issuer">): string {
  return `---
name: ${skillFolderName(org)}
description: >-
  Billing for ${org.name}. Use whenever the request involves invoices, clients,
  what is owed, overdue accounts, payment statements or tax statements for this
  business.
---

# Billing for ${org.name}

You can read and change this business's billing data through a set of tools
served over MCP. There is no other way in, and no way to reach anybody else's
data: the key you are configured with belongs to this business alone.

## What this business is

- Printed name on documents: **${org.name}**
- ${org.tax_id_label}: **${issuer?.abn ?? "not set"}**${
    issuer ? `\n- Invoices are issued by: **${issuer.full_name}**` : ""
  }
- Payment terms: **${org.terms_days} days** from the invoice date
- Time zone: **${org.timezone}**
- Currency: AUD${org.gst_registered ? "\n- Registered for GST. Prices INCLUDE it, so the tax is already inside every total, never added on top." : ""}
${limitsSection(org)}
## Rules that are not yours to bend

1. **Deleting an invoice always needs the user's confirmation first.** Every
   other action (create, edit, mark paid, cancel) does not. Prefer cancelling
   over deleting anything that has already been sent: cancelling keeps the
   record and its number, deleting frees the number for reuse.
2. **Never invent a service date.** \`service_date\` is the day the work was
   actually done and is often not the invoice date. If you do not know it, ask.
3. **Resolve relative dates with the \`today\` tool**, never from your own
   clock. You may be running in a different time zone than the business.
4. **There are no partial payments.** An invoice is unpaid, paid or cancelled.
   Anything unusual about a payment belongs in \`internal_notes\`.
5. **\`internal_notes\` are never printed.** They are for the owner's eyes.
6. Changing a client's rate never rewrites past invoices. Each invoice keeps
   the rate, the address and the ${org.tax_id_label} it was issued under.

## The tools

**Getting your bearings**
- \`today\`: today's date in this business's time zone, plus the last 14 days
  with weekday names. Use it before interpreting "yesterday" or "last Tuesday".
- \`business_snapshot\`: outstanding, overdue, billed this month / this
  financial year / all time, and paid all time. One call, the whole picture.

**Questions about money**
- \`who_owes\`: every client with an unpaid balance.
- \`overdue_invoices\`: everything past its due date.
- \`client_summary\`: one client's billed, paid, outstanding and last invoice.
- \`client_account\`: that client's unpaid invoices, one row each.
- \`billed_in_period\`: totals between two dates.
- \`fy_summary\`: billed and paid for a financial year.
- \`gst_position\`: GST collected this BAS quarter and this year, on a cash
  basis. The only place a GST figure comes from.

**Finding things**
- \`find_invoices\`: search by client, status, or date range.
- \`recent_invoices\`: the latest ones, optionally for one client.
- \`get_invoice\`: one invoice with its line items.
- \`list_clients\`: every client, their address and their agreed rate.
- \`list_issuers\`: the ${org.tax_id_label}s this business invoices under. You
  will rarely need it; see "Creating an invoice" below.

**Changing things**
- \`create_invoice\`: see below.
- \`update_invoice\`: REPLACES the whole item list, so send every line, not
  just the changed one. Anything you leave out (client, date, notes) keeps
  what the invoice already has.
- \`mark_paid\`, \`mark_unpaid\`, \`cancel_invoice\`, \`reactivate_invoice\`.
- \`delete_invoice\`: needs \`confirm: true\`, and only after the user has said so.
- \`create_client\`, \`update_client\`. To stop dealing with a client, archive
  them: \`update_client\` with \`is_active: false\`. They keep every invoice they
  were ever sent and stop appearing when a new one is raised.
- \`delete_client\`: needs \`confirm: true\`, and only ever for a client entered
  by mistake. One who has been invoiced cannot be deleted at all: archive them.

**Documents**
- \`get_invoice_pdf\`, \`get_client_statement\`, \`get_tax_statement\`.
- \`prepare_client_email\`: recipient, filled-in message and the invoice PDFs,
  ready to send with your own email tool. This app never sends anything itself.
- \`prepare_client_statement_email\`: the same for an account statement.

**Housekeeping**
- \`create_backup\`: the whole business as a file, by download link. It comes as
  an **Excel workbook** (a sheet per table), which is what somebody means when
  they ask for their data. Only pass \`format: "json"\` when they ask for JSON:
  that is the complete, restorable copy rather than the readable one.

## Creating an invoice

\`\`\`json
{ "client": "Newtown Pet Supplies",
  "items": [{ "service_date": "2026-08-10", "rate": 320,
              "description": "Store fit-out deep clean" }] }
\`\`\`

That is the whole thing. Name the client the way the user does; you do not need
to look up an id first.

If a create ever times out, do not guess whether it landed: retry it with the
same \`idempotency_key\` (any stable string of your own) and you will be handed
the original invoice back instead of raising a second one. Without a key, a
second identical invoice for the same client, day and amount is refused, and
the refusal names the invoice that already exists. The ${org.tax_id_label} billing is worked out for you,
and \`invoice_date\` defaults to today here, which is usually right: the service
date is the day the work happened, the invoice date is the day you bill it.

Use the client's \`default_rate\` unless the user says otherwise. If the client
has a usual service agreed, the description can be left out; otherwise say what
the work was.

## Handing over a file

The three document tools and \`create_backup\` answer with a **download link**
that works for 30 minutes, plus the filename and the size. They do not dump the
file into our conversation, because a PDF is about 60,000 characters of base64
and most assistants refuse a result that big.

So: if you can write files, fetch the link and save it to the user's Downloads
folder, then tell them the path. If you cannot, give them the link. Only pass
\`include_base64: true\` when you genuinely need the bytes in hand, for example
to attach the file to an email yourself.

Statements are of what is still **unpaid**, so fetch one before marking an
invoice paid, not after.

## How to work

Look before you write. \`list_clients\` gives you every client, their address
and their agreed rate in one call. When something is ambiguous, ask instead of
guessing: a wrong invoice is more work to undo than a question is to answer.
`;
}

function referenceMd({ org, baseUrl }: SkillContext): string {
  return `# How this connects

Your AI talks to the billing app, not to a database. The app holds the
credentials and enforces the rules, which is why an agent key is safe to hand
to an assistant.

    your AI  ->  MCP  ->  ${baseUrl}  ->  the database

## Endpoints

- **MCP** (what most assistants use): \`${baseUrl}/api/mcp\`
- **REST** (one tool per call, useful for scripts):
  \`POST ${baseUrl}/api/agent/<tool>\` with a JSON body

Both take the same key, either as \`Authorization: Bearer <key>\` or as
\`x-api-key: <key>\`.

## Document links

The PDF and backup tools answer with a link to \`${baseUrl}/api/agent/download/...\`.
It carries its own signed token, so it opens in a browser with no key and no
login, and it stops working after 30 minutes. Nothing is stored: opening it
renders the document again from live data.

## What the key can and cannot do

It can call the tools listed in SKILL.md, on **${org.name}** and nothing else.
It cannot run SQL, name a table, reach another business's data, or touch
anything outside billing. Revoke it from the dashboard at any time and it stops
working immediately.

## A quick check

    curl -s -X POST ${baseUrl}/api/agent/business_snapshot \\
      -H "Authorization: Bearer YOUR_KEY" \\
      -H "content-type: application/json" -d '{}'

A JSON object with your totals means everything is wired up.
`;
}

function installMd(ctx: SkillContext): string {
  const folder = skillFolderName(ctx.org);
  const server = mcpServerName(ctx.org);
  const envVar = `${server.toUpperCase().replace(/-/g, "_")}_KEY`;
  return `# Installing this

## The short way: no key, no files

If your assistant runs somewhere with a browser, you do not need this zip at
all. Point it at the app with no credential and approve it when the browser
opens:

    claude mcp add --transport http ${server} ${ctx.baseUrl}/api/mcp --scope user

Run \`/mcp\` in Claude Code and choose this server to authorise it. Codex opens
the browser the first time it calls a tool. For Claude Desktop, add the same URL
with \`"type": "http"\` and no header.

You approve on a page of this app that lists exactly what the assistant will be
able to do, and you can untick anything you would rather it could not. Nothing
is copied anywhere, the connection expires and renews itself, and you can cut it
off from the Agents page at any time.

Once connected, it reads how this business works by calling \`get_started\`, so
the skill folder below is optional: it is the same guidance as a file, useful if
you would rather your assistant always had it loaded, or want to read it before
trusting it.

## The key way

Use a key when the thing connecting has **no browser**: a server, a cron job, a
script. The key is in the commands below, already filled in. It is a password in
a plain text file, so treat it like one.

## Claude Code

    claude mcp add --transport http ${server} ${ctx.baseUrl}/api/mcp \\
      --header "Authorization: Bearer ${ctx.key}" --scope user

Then copy the \`${folder}\` folder into \`~/.claude/skills/\`.

**Restart Claude Code afterwards.** A session that is already open loaded its
list of tools when it started and will not see the new ones until it does.

## Claude Desktop

Edit \`claude_desktop_config.json\` and add:

${"```"}json
{
  "mcpServers": {
    "${server}": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "${ctx.baseUrl}/api/mcp", "--header", "Authorization:\${AUTH_HEADER}"],
      "env": { "AUTH_HEADER": "Bearer ${ctx.key}" }
    }
  }
}
${"```"}

Restart Claude Desktop, then upload the skill folder from its settings.

## Codex

In \`~/.codex/config.toml\`:

${"```"}toml
[mcp_servers.${server.replace(/-/g, "_")}]
url = "${ctx.baseUrl}/api/mcp"
bearer_token_env_var = "${envVar}"
${"```"}

Set \`${envVar}\` to your key in your environment, then copy the \`${folder}\`
folder into \`~/.codex/skills/\`. Restart Codex afterwards.

## Anything else

Any assistant that speaks MCP over HTTP works. Point it at
\`${ctx.baseUrl}/api/mcp\` with the \`Authorization: Bearer\` header, and give it
the SKILL.md file as instructions.

---

## About the key in this file

This zip was built with your key already filled in, so that installing is one
copy and paste. The cost of that convenience is that **the key is written in
plain text in this file**, and if you copy the whole folder into your skills
directory, it stays there for any assistant to read.

For trying the app out, that is fine, and you can revoke the key from the Agent
keys page at any time. Before you rely on this for anything real:

1. Delete this \`INSTALL.md\` once you have installed. The skill does not need it.
2. Keep the key out of the skill folder. Put it in an environment variable and
   point the MCP config at the variable, the way the Codex example above does.
3. Treat it like a password: do not email it, do not commit it to a repository.
   If it gets out, revoke it and mint a new one, which takes a few seconds.
`;
}

function mcpConfigJson(ctx: SkillContext): string {
  return `${JSON.stringify(
    {
      mcpServers: {
        [mcpServerName(ctx.org)]: {
          type: "http",
          url: `${ctx.baseUrl}/api/mcp`,
          headers: { Authorization: `Bearer ${ctx.key}` },
        },
      },
    },
    null,
    2,
  )}\n`;
}

/** The files of the kit, keyed by their path inside the zip. */
export function buildSkillFiles(ctx: SkillContext): Record<string, string> {
  const folder = skillFolderName(ctx.org);
  return {
    [`${folder}/SKILL.md`]: guidanceMarkdown(ctx),
    [`${folder}/references/connection.md`]: referenceMd(ctx),
    [`${folder}/INSTALL.md`]: installMd(ctx),
    [`${folder}/mcp-config.json`]: mcpConfigJson(ctx),
  };
}

/**
 * The one block a person can paste into a fresh chat to have their assistant
 * set itself up. Written as instructions to the assistant, not to the person.
 */
export function buildInstallPrompt(ctx: SkillContext): string {
  const { org, baseUrl, key } = ctx;
  const server = mcpServerName(org);
  return `Connect yourself to my billing system.

It is an MCP server over HTTP:

  URL:    ${baseUrl}/api/mcp
  Header: Authorization: Bearer ${key}

Add it to your MCP configuration under the name "${server}", using whatever
mechanism you support (a config file, a CLI command, or your settings UI).

Then restart yourself. Most assistants read their list of tools once at
startup, so a session that is already open will report the connection as
working while having no tools from it. Once you are back, confirm by calling
"business_snapshot" and telling me what it says.

Once connected, these are the rules for this business, ${org.name}:

- Payment terms are ${org.terms_days} days, and dates are in ${org.timezone}.
  Always resolve "yesterday" or "last Tuesday" with the "today" tool rather
  than from your own clock.
- Ask me before deleting an invoice. Never delete without my say-so. Cancelling
  is usually what I mean anyway, and it keeps the record.
- Never invent a service date. It is the day the work was done and it is often
  not the invoice date. If you do not know it, ask me.
- There are no partial payments: an invoice is unpaid, paid or cancelled.
- To bill someone, "create_invoice" needs the client's name and the line items.
  Nothing else: the ABN and the invoice date are worked out for you.
- The PDF tools answer with a download link, not with the file. Save it to my
  Downloads folder if you can write files, otherwise just give me the link.

One last thing, when you are done: my key is written in plain text inside the
zip I downloaded, and inside the skill folder if you copied it there. Tell me
that, and tell me how to fix it if I decide to use this for real: delete the
INSTALL.md, keep the key in an environment variable instead of in the config
file, and mint a fresh key from the Agent keys page if this one has been sitting
around.

Tell me when you are connected and show me what I am owed.`;
}
