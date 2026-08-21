import Link from "next/link";
import { orgForPage } from "@/lib/data/org";
import { appBaseUrl } from "@/lib/app-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { Step, AgentKit, CopyBlock } from "./guide-client";
import { ConnectCommand } from "../agent-keys/connect-command";
import { serverName } from "../agent-keys/server-name";

/**
 * The setup guide, in three parts that are deliberately separated because
 * people conflate them:
 *
 *   1. Try it here      - the app on this site, with your own data.
 *   2. Connect your AI  - your assistant, our server, still our database.
 *   3. Take it with you - your server, your database, nothing of ours.
 *
 * Most of the confusion about what this product is comes from those three
 * being told as one story, so the page tells them as three.
 */
export default async function GuidePage() {
  const org = await orgForPage();
  const db = createAdminClient();
  const head = { count: "exact" as const, head: true };

  const [clients, invoices, keys] = await Promise.all([
    db.from("clients").select("*", head).eq("org_id", org.id),
    db.from("invoices").select("*", head).eq("org_id", org.id),
    db.from("agent_keys").select("*", head).eq("org_id", org.id),
  ]);

  const baseUrl = await appBaseUrl();

  const done = (org.onboarding ?? {}) as Record<string, boolean>;
  const hasClients = (clients.count ?? 0) > 0;
  const hasInvoices = (invoices.count ?? 0) > 0;
  const hasKeys = (keys.count ?? 0) > 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Setting up
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          From your first invoice to your own AI doing the billing for you
        </p>
      </div>

      <Section
        title="1. Try it here"
        hint="Everything works right now, with your own business details, on this site."
      >
        <Step n={1} title="Create your business" done>
          <p>
            Done. <strong>{org.name}</strong> is set up with{" "}
            {org.terms_days}-day payment terms.{" "}
            <Link href="/settings" className="underline">
              Change any of it
            </Link>{" "}
            whenever you like, including your logo.
          </p>
        </Step>

        <Step n={2} title="Add a client" done={hasClients}>
          <p>
            A client is a name and an address, which is all it takes to invoice
            somebody.{" "}
            <Link href="/clients" className="underline">
              Add your first client
            </Link>
            .
          </p>
        </Step>

        <Step n={3} title="Create an invoice and open the PDF" done={hasInvoices}>
          <p>
            Numbering starts at #1 and is yours alone.{" "}
            <Link href="/invoices/new" className="underline">
              Create an invoice
            </Link>
            , then open its PDF to see your details and logo on it.
          </p>
        </Step>
      </Section>

      <Section
        title="2. Connect your own AI"
        hint="Your assistant, talking to this app. It does the work; you keep paying only for your own AI usage."
      >
        <Step n={4} title="Connect your assistant" done={hasKeys}>
          <p>
            Paste the block below to whichever AI you use and it connects
            itself, then sends you to a page here where you approve it and
            choose what it is allowed to do. There is no key to create and
            nothing to download.
          </p>
          {/* The same picker the Agents page uses, rather than a second copy
              of one assistant's command: whoever reads this guide may not be
              using Claude at all, and a line that starts with `claude` reads
              as a requirement. */}
          <ConnectCommand baseUrl={baseUrl} server={serverName(org.name)} />
          <p>
            Everything currently connected, and the keys, live on{" "}
            <Link href="/agent-keys" className="underline">
              Agents
            </Link>
            .
          </p>
          <p>
            <strong>Use a key instead when there is no browser</strong>, which
            means a server, a cron job or a script. You mint those on the same
            page, choosing what each one may do and when it expires.
          </p>
          <AgentKit hasKey={hasKeys} />
        </Step>

        <Step
          n={5}
          title="Install it in your assistant"
          done={Boolean(done.installed)}
          stepId="installed"
        >
          <p>
            After running the command, tell your assistant to connect. Each one
            asks in its own way: Claude Code lists the server under{" "}
            <code>/mcp</code> once it has been restarted, Codex opens the
            browser the first time it calls a tool, and anything else will say
            it needs authorising. You approve on a page here that spells out
            what it will be able to do.
          </p>
          <p>
            It learns how your business works by itself on its first question,
            so there is nothing to install afterwards. The kit above is the same
            briefing as files, for when you would rather read it first or keep
            it loaded permanently.
          </p>
          <p>
            <strong>Then restart your assistant.</strong> Most of them read
            their list of tools once when they start, so a chat you already had
            open will say it is connected and still have nothing to call.
          </p>
          <p>
            Anything that speaks MCP over HTTP works. The address is always the
            same:
          </p>
          <CopyBlock text={`${baseUrl}/api/mcp`} />
        </Step>

        <Step
          n={6}
          title="Ask it something"
          done={Boolean(done.tested)}
          stepId="tested"
        >
          <p>
            Try <em>&ldquo;what am I owed?&rdquo;</em> first, then{" "}
            <em>&ldquo;invoice {org.name === "" ? "them" : "my client"} for
            Tuesday&rsquo;s work&rdquo;</em>. It will ask you for anything it
            does not know rather than guess.
          </p>
        </Step>
      </Section>

      <Section
        title="3. Take it with you"
        hint="Run the whole thing yourself: your server, your database, no limits and nothing of ours."
      >
        <Step
          n={7}
          title="Export your data"
          done={Boolean(done.exported)}
          stepId="exported"
        >
          <p>
            Your invoices, clients and business details, in one file you keep.{" "}
            <Link href="/backup" className="underline">
              Download a backup
            </Link>{" "}
            as JSON (complete, restorable) or Excel (readable).
          </p>
        </Step>

        <Step
          n={8}
          title="Install your own copy"
          done={Boolean(done.self_hosted)}
          stepId="self_hosted"
        >
          <p>
            The source is public and the database schema is one file. You need a
            free Supabase project and a free Vercel account.
          </p>
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>
              Clone{" "}
              <a
                href="https://github.com/cryptotweezer/awesome"
                className="underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                the repository
              </a>
              .
            </li>
            <li>
              Create a Supabase project and run{" "}
              <a href="/guide/schema.sql" className="underline">
                schema.sql
              </a>{" "}
              in its SQL editor. That creates everything.
            </li>
            <li>Set these environment variables, then deploy:</li>
          </ol>
          <CopyBlock
            text={`NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
ALLOWED_EMAILS=you@example.com
AGENT_KEY_PEPPER=<any long random string>
APP_URL=https://your-own-domain`}
          />
          <p>
            On your own copy there are no trial limits, nothing is deleted at
            the end of the month, and your data never leaves your account.
          </p>
        </Step>
      </Section>

      {org.is_demo && (
        <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-600 ring-1 ring-slate-200 dark:bg-slate-900/50 dark:text-slate-400 dark:ring-slate-800">
          This is a trial account: up to {org.max_invoices} invoices and{" "}
          {org.max_clients} clients, and it is deleted on the 1st of the month
          whether you used it or not. Export whenever you like, and install your
          own copy when you are ready to bill for real.
        </p>
      )}
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
          {title}
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">{hint}</p>
      </div>
      {children}
    </section>
  );
}
