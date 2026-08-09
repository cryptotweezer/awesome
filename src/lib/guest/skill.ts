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

function skillMd({ org, issuer }: SkillContext): string {
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
- Currency: AUD

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
- \`today\` — today's date in this business's time zone, plus the last 14 days
  with weekday names. Use it before interpreting "yesterday" or "last Tuesday".
- \`business_snapshot\` — outstanding, overdue, billed this month / this
  financial year / all time, and paid all time. One call, the whole picture.

**Questions about money**
- \`who_owes\` — every client with an unpaid balance.
- \`overdue_invoices\` — everything past its due date.
- \`client_summary\` — one client's billed, paid, outstanding and last invoice.
- \`client_account\` — that client's unpaid invoices, one row each.
- \`billed_in_period\` — totals between two dates.
- \`fy_summary\` — billed and paid for a financial year.

**Finding things**
- \`find_invoices\` — search by client, status, or date range.
- \`recent_invoices\` — the latest ones, optionally for one client.
- \`get_invoice\` — one invoice with its line items.
- \`list_clients\` — every client and their agreed rate.

**Changing things**
- \`create_invoice\` — needs \`client_id\`, \`issuer_id\` and \`items\`. Each item
  is \`{service_date, rate, description?, quantity?}\`. Take \`issuer_id\` and the
  rate from \`list_clients\`.
- \`update_invoice\` — REPLACES the whole item list, so send all of them.
- \`mark_paid\`, \`mark_unpaid\`, \`cancel_invoice\`, \`reactivate_invoice\`.
- \`delete_invoice\` — needs \`confirm: true\`, and only after the user has said so.
- \`create_client\`, \`update_client\`.

**Documents and email**
- \`get_invoice_pdf\`, \`get_client_statement\`, \`get_tax_statement\` — the PDF
  comes back as base64 for you to attach or forward.
- \`prepare_client_email\` — recipient, filled-in message and the invoice PDFs,
  ready to send with your own email tool. This app never sends anything itself.
- \`prepare_client_statement_email\` — the same for an account statement.

**Housekeeping**
- \`create_backup\` — the whole business as a JSON file, base64.

## How to work

Look before you write. \`list_clients\` gives you the client id, the issuer id
and the agreed rate in one call, which is everything \`create_invoice\` needs.
When something is ambiguous, ask instead of guessing: a wrong invoice is more
work to undo than a question is to answer.
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
  return `# Installing this

Two things go into your assistant: the **skill** (the folder in this zip, which
teaches it how this business works) and the **MCP server** (the connection,
which is what lets it actually do anything).

The fastest route is to paste the prompt from the setup page and let your
assistant configure itself. If you would rather do it by hand:

## Claude Code

    claude mcp add --transport http awesome ${ctx.baseUrl}/api/mcp \\
      --header "Authorization: Bearer ${ctx.key}" --scope user

Then copy the \`${folder}\` folder into \`~/.claude/skills/\`.

## Claude Desktop

Edit \`claude_desktop_config.json\` and add:

${"```"}json
{
  "mcpServers": {
    "awesome": {
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
[mcp_servers.awesome]
url = "${ctx.baseUrl}/api/mcp"
bearer_token_env_var = "AWESOME_BILLING_AGENT_KEY"
${"```"}

Set \`AWESOME_BILLING_AGENT_KEY\` to your key in your environment, then copy the
\`${folder}\` folder into \`~/.codex/skills/\`.

## Anything else

Any assistant that speaks MCP over HTTP works. Point it at
\`${ctx.baseUrl}/api/mcp\` with the \`Authorization: Bearer\` header, and give it
the SKILL.md file as instructions.

---

**This zip contains your key.** Treat it like a password: do not email it, do
not commit it to a repository. If it gets out, revoke it on the Agent keys page
and generate a new one, which takes a few seconds.
`;
}

function mcpConfigJson(ctx: SkillContext): string {
  return `${JSON.stringify(
    {
      mcpServers: {
        awesome: {
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
    [`${folder}/SKILL.md`]: skillMd(ctx),
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
  return `Connect yourself to my billing system.

It is an MCP server over HTTP:

  URL:    ${baseUrl}/api/mcp
  Header: Authorization: Bearer ${key}

Add it to your MCP configuration under the name "awesome", using whatever
mechanism you support (a config file, a CLI command, or your settings UI), then
restart yourself if you need to and confirm the connection by calling the
"business_snapshot" tool.

Once connected, these are the rules for this business, ${org.name}:

- Payment terms are ${org.terms_days} days, and dates are in ${org.timezone}.
  Always resolve "yesterday" or "last Tuesday" with the "today" tool rather
  than from your own clock.
- Ask me before deleting an invoice. Never delete without my say-so. Cancelling
  is usually what I mean anyway, and it keeps the record.
- Never invent a service date. It is the day the work was done and it is often
  not the invoice date. If you do not know it, ask me.
- There are no partial payments: an invoice is unpaid, paid or cancelled.
- Look before you write: "list_clients" gives you the client id, the issuer id
  and the agreed rate in one call, which is everything "create_invoice" needs.

Tell me when you are connected and show me what I am owed.`;
}
