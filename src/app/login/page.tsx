import Image from "next/image";
import { ThemeToggle } from "@/components/theme-toggle";
import { isGuestSignupEnabled } from "@/lib/auth";
import { appBaseUrl } from "@/lib/app-url";
import { LoginButton } from "./login-button";
import { ChatDemo } from "./chat-demo";
import { Reveal, ScrollProgress, SectionLinks, CopyLine } from "./motion";

/**
 * The public page: what this system is, and the two different ways an AI gets
 * to work inside it.
 *
 * That distinction is the whole point of the page and it is the thing people
 * get wrong, so it is told in two sections rather than one. An assistant you
 * drive (Claude, Codex, Copilot, Gemini) connects with one command, approves
 * itself in the browser, and does what you ask while you are there. An agent that runs on its own (Hermes,
 * OpenClaw) connects exactly the same way, and everything extra it can do,
 * sending the email, waking up on a schedule, answering you on your phone,
 * comes from that agent's own setup, never from here.
 */

const MESSAGES: Record<string, string> = {
  unauthorized: "That Google account is not on the list for this deployment.",
  auth: "Something went wrong while signing in. Please try again.",
  blocked: "Too many sign-in attempts from here. Wait a minute and try again.",
};

const NAV = [
  { id: "assistant", label: "Assistant" },
  { id: "connect", label: "Connect your AI" },
  { id: "agents", label: "Agents" },
];

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message = error ? MESSAGES[error] : null;
  const signupOpen = isGuestSignupEnabled();
  const baseUrl = await appBaseUrl();

  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <ScrollProgress />

      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/85 backdrop-blur dark:border-slate-800 dark:bg-slate-950/85">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
          <a href="#top" className="flex shrink-0 items-center gap-2.5">
            {/* Two files, one hidden per theme. Swapping in JS would flash. */}
            <Image
              src="/logo_ah_black.png"
              alt=""
              width={30}
              height={30}
              className="dark:hidden"
              priority
            />
            <Image
              src="/logo_ah_white.png"
              alt=""
              width={30}
              height={30}
              className="hidden dark:block"
              priority
            />
            <span className="text-base font-bold tracking-tight">
              AI Billing Service
            </span>
          </a>

          <SectionLinks items={NAV} />

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LoginButton compact />
          </div>
        </div>
      </header>

      <main id="top" className="mx-auto max-w-5xl px-6">
        {/* Hero */}
        <section className="py-20 sm:py-28">
          <Reveal>
            <p className="mb-4 text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
              AI Billing System
            </p>
            <h1 className="max-w-3xl text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
              Invoicing an AI can actually run.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-600 dark:text-slate-400">
              A complete billing dashboard with an assistant built into it, and
              an open door for every AI you already use. Raise an invoice, find
              out who owes you, chase what is late, pull a client statement or a
              whole financial year for your accountant, by asking for it in
              plain words.
            </p>
          </Reveal>

          {message && (
            <div className="mt-8 max-w-md rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900">
              {message}
            </div>
          )}

          <Reveal delay={80}>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <div className="w-full max-w-xs">
                <LoginButton />
              </div>
              <a
                href="#connect"
                className="rounded-lg px-4 py-3 text-sm font-medium text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900"
              >
                See how it connects ↓
              </a>
            </div>

            {/* Only promised when it is actually true. Signing up is opened by
                the GUEST_SIGNUP environment variable, not by this deploy. The
                trial's actual allowances are not printed here: the dashboard
                shows them from the first screen, and a number on a landing page
                is a number waiting to go out of date. */}
            {signupOpen && (
              <p className="mt-5 max-w-xl text-sm text-slate-500 dark:text-slate-400">
                Free to try with your own business details. A trial account
                comes with room to invoice properly, and the dashboard tells you
                what is left as you go.
              </p>
            )}
          </Reveal>

          <Reveal delay={140}>
            <Diagram />
          </Reveal>
        </section>

        {/* The trial. Described only where it can actually be taken up: on a
            deployment with sign-up closed, this whole section would be an
            invitation to a door that does not open. */}
        {signupOpen && (
          <Section
            id="try"
            eyebrow="The demo"
            title="Try it with your own business, in a minute"
            lead="Sign in with Google and the system sets up a business that is yours: your name, your logo, your payment terms, your tax details, your invoice numbering starting at #1. Nothing is shared with anybody else's account and nothing is a mock-up: every invoice you raise is a real, printable invoice."
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Card
                title="Your business, not a sandbox"
                body="Set your ABN, add an ACN if you are a company, switch GST on if you are registered, upload your logo. Everything you print carries it."
              />
              <Card
                title="Real documents from the first minute"
                body="Invoice PDFs, a reminder statement per client and a full financial-year statement for your accountant. Built when you ask for them, never stored."
              />
              <Card
                title="An assistant included"
                body="The built-in assistant comes with the trial, so you can create and chase invoices by asking, before you connect anything of your own."
              />
              <Card
                title="Room to have a proper look"
                body="Enough clients and invoices to bill a real month and see how it behaves, not a five-minute tour. What you have used is on your dashboard from the first screen."
              />
              <Card
                title="Cleared out every 30 days"
                body="Trial accounts are deleted automatically 30 days after sign-up. Nobody's business details sit on a server they stopped using, and a trial you forgot about cannot become a leak."
              />
              <Card
                title="Nothing is locked in"
                body="Download everything as JSON or Excel whenever you like. The source is public and the database is one SQL file, so you can run the whole thing on your own accounts."
              />
            </div>
          </Section>
        )}

        {/* The dashboard assistant */}
        <Section
          id="assistant"
          eyebrow="Built in"
          title="An assistant that sits inside the dashboard"
          lead="Not a chat bolted onto the side. It runs the very same guarded functions the forms do, so whatever it says it did, it did, and it shows up on your dashboard a second later."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card
              title="Raise an invoice from a sentence"
              body={`"Invoice that client for yesterday's job, $150, and note that they are paying next week." It works out the client, the rate, the day the work was done and the due date, and asks when it is not sure.`}
            />
            <Card
              title="Keep the books moving"
              body="Mark an invoice paid or unpaid, cancel one that went out wrong, bring a cancelled one back, correct a line. Deleting is the one thing it will not do without asking you first."
            />
            <Card
              title="Answer the money questions"
              body="Who owes you, what is overdue and by how many days, what you billed this month or this financial year, how one client's account stands, how much GST you have collected this quarter."
            />
            <Card
              title="Hand you the documents"
              body="Ask for an invoice, a client statement or your financial-year tax statement and it gives you the file, ready to open. Same for a full backup of the business."
            />
            <Card
              title="Look after your clients"
              body="Add one, fix an address, change the rate you charge. A rate change applies to what you bill from now on and never rewrites an invoice already sent."
            />
            <Card
              title="In your own language"
              body="It answers in whatever language you write in, and it works out dates like yesterday or last Tuesday in your business's time zone, not in whatever zone the server is in."
            />
          </div>

          <div className="mt-6 rounded-2xl bg-slate-50 p-6 dark:bg-slate-900">
            <h3 className="font-semibold">
              Ask it to send something and you get it, ready to send
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              Ask for an invoice or a client&apos;s statement and your copy of
              the finished document comes back in the chat, made at that moment
              and correct as of that moment, ready to attach to an email and go.
              To have it leave on its own instead, give the job to an{" "}
              <a
                href="#agents"
                className="font-medium underline underline-offset-2"
              >
                agent with its own mailbox
              </a>
              .
            </p>
          </div>
        </Section>

        {/* Connect your own AI */}
        <Section
          id="connect"
          eyebrow="Your own AI"
          title="Connect the assistant you already use"
          lead="One command, then approve it in your browser. No key to copy, nothing to download, nothing to configure. The app is the gateway: every AI reaches your books through the same door and inherits every rule underneath it. Claude Code, Claude Desktop, Codex, Copilot CLI, Gemini, Cursor: whatever speaks MCP over HTTP is already compatible."
        >
          <ol className="grid gap-4 lg:grid-cols-3">
            <Step
              n="1"
              title="Run one command"
              body="Point your assistant at the app. No key to generate, nothing to paste in, nothing to download."
            />
            <Step
              n="2"
              title="Approve it in your browser"
              body="A page here shows which assistant is asking and exactly what it will be able to do. Untick anything you would rather it could not, and confirm."
            />
            <Step
              n="3"
              title="Ask it for something"
              body={`"What am I owed?" is the usual first question. It reads how your business works by itself, so there is no setup after this.`}
            />
          </ol>

          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl p-6 ring-1 ring-slate-200 lift dark:ring-slate-800">
              <h3 className="font-semibold">How it knows your business</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                On its first question it asks the app how things work here, and
                gets back your printed name, your ABN, your payment terms, your
                time zone, the rules it is not allowed to bend and the full list
                of tools. Nothing to install: the briefing comes down the same
                connection.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                You can also download it as a folder, which is the same text as
                files. Worth it if you would rather read it before trusting it,
                or want your assistant to keep it loaded permanently:
              </p>
              <ul className="mt-4 space-y-1.5 text-sm text-slate-600 dark:text-slate-400">
                <li>
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">
                    SKILL.md
                  </code>{" "}
                  what your business is and how to bill for it
                </li>
                <li>
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">
                    INSTALL.md
                  </code>{" "}
                  the exact commands, per assistant
                </li>
                <li>
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">
                    mcp-config.json
                  </code>{" "}
                  the connection, ready to paste
                </li>
                <li>
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">
                    references/
                  </code>{" "}
                  how the gateway works, and a curl to test it
                </li>
              </ul>
              <p className="mt-4 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                Installing it is copying that folder where your assistant keeps
                its skills, <code className="text-xs">~/.claude/skills/</code>{" "}
                or <code className="text-xs">~/.codex/skills/</code>, or
                uploading it in Claude Desktop.
              </p>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl p-6 ring-1 ring-slate-200 lift dark:ring-slate-800">
                <h3 className="font-semibold">One command, as an example</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  This is the whole connection for Claude Code. Codex takes
                  three lines of TOML, Claude Desktop a small JSON block, and
                  both are written out for you in the kit.
                </p>
                <div className="mt-4">
                  <CopyLine
                    text={`claude mcp add --transport http billing \\\n  ${baseUrl}/api/mcp \\\n  --header "Authorization: Bearer YOUR_KEY" --scope user`}
                  />
                </div>
              </div>

              <div className="rounded-2xl p-6 ring-1 ring-slate-200 lift dark:ring-slate-800">
                <h3 className="font-semibold">Or from any script</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  Every tool is also one plain HTTP call, for anything that does
                  not speak MCP. A server or a cron job has no browser to
                  approve anything in, so that is what keys are for.
                </p>
                <div className="mt-4">
                  <CopyLine
                    text={`curl -X POST ${baseUrl}/api/agent/business_snapshot \\\n  -H "Authorization: Bearer YOUR_KEY" \\\n  -H "content-type: application/json" -d '{}'`}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-2xl bg-slate-50 p-6 dark:bg-slate-900">
            <h3 className="font-semibold">
              What a connected assistant can and cannot reach
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              It calls billing tools on your business and nothing else. It
              cannot run SQL, cannot name a table, cannot see another business,
              and cannot reach anything outside billing. You choose what each one
              is allowed to do when you approve it: look only, or also create and
              edit, or also delete. Cutting one off takes a couple of seconds and
              stops it immediately, with every other assistant still working.
            </p>
          </div>
        </Section>

        {/* Autonomous agents */}
        <Section
          id="agents"
          eyebrow="Agents"
          title="Or hand it to an agent that runs on its own"
          lead="An assistant works while you are in front of it. An agent lives on a machine of its own, with its own inbox, its own schedule and its own chat with you. Both connect here in exactly the same way, with a key and the skill. The difference is what the agent can do around the billing."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <Compare
              kind="Assistants you drive"
              names="Claude Code · Claude Desktop · Codex · Copilot CLI · Gemini · Cursor"
              points={[
                "You ask, it does it, the file comes back in your chat.",
                "Runs where you already work: your terminal, your editor, your desktop.",
                "One command and a click to approve. No key changes hands.",
                "Nothing happens when you are not there, which is often exactly what you want.",
              ]}
            />
            <Compare
              kind="Agents that run by themselves"
              names="Hermes · OpenClaw · anything self-hosted"
              points={[
                "Lives on a server or a phone bot and answers you in your messaging app.",
                "Has its own email, so it can actually send the invoice to your client.",
                "Can be put on a schedule: bill the same clients on the 1st, chase overdue every Monday.",
                "Connects with a key instead, because a server has no browser to approve anything in. Same tools, same rules.",
              ]}
              highlight
            />
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card
              title="Invoices that send themselves"
              body="The app prepares the recipient, the message and the attachment; the agent sends it from its own mail. Your client gets the bill without you opening anything."
            />
            <Card
              title="Billing on a schedule"
              body="A cron job on the agent's side: the monthly invoices go out on the 1st, the overdue reminders on Monday morning, the tax statement at the end of the year."
            />
            <Card
              title="Your whole business from your phone"
              body="Message the agent between jobs and it invoices, chases, answers and sends the PDF back into the chat. No dashboard, no laptop."
            />
            <Card
              title="Work you never see"
              body="It can watch what is falling behind and tell you, rather than waiting for you to ask. You hear about the account that went quiet."
            />
          </div>

          <p className="mt-6 max-w-3xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            All of that depends on how you set that agent up: its email account,
            its scheduler, its permissions, what you allow it to do on its own.
            This app never sends an email and never runs a job by itself, and
            that is on purpose. What it does guarantee is the part underneath:
            the same numbering, the same confirmation before a deletion, the
            same frozen prices on invoices already sent, no matter which agent
            is asking.
          </p>

          <div className="mt-10">
            <h3 className="text-lg font-semibold">
              What that looks like in practice
            </h3>
            <p className="mt-2 max-w-2xl text-slate-600 dark:text-slate-400">
              A morning with an agent on your phone, doing the parts you would
              otherwise sit down for.
            </p>
            <div className="mt-6">
              <ChatDemo />
            </div>
          </div>
        </Section>

        {/* Output */}
        <Section
          eyebrow="What you get"
          title="Everything your books need, on request"
          lead="Built from one set of records at the moment you ask, so two answers can never disagree with each other."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card
              title="Answers, just by asking"
              body="Who owes you, what is overdue, what you billed this month, this financial year, or all time, and the GST inside it. No dashboards to build."
            />
            <Card
              title="Invoices, ready to send"
              body="Numbered, filed and printed the second you ask for one, with your logo and your details on them."
            />
            <Card
              title="Your whole billing history"
              body="Every invoice you have ever raised, in one list you can filter by client, status or date. Unpaid on top, paid and cancelled below."
            />
            <Card
              title="Reminders that write themselves"
              body="One statement per client showing everything they still owe, ready to send the moment an account starts falling behind."
            />
            <Card
              title="Tax time, already sorted"
              body="A full financial year of invoices for one ABN, in a single file you can hand straight to your accountant."
            />
            <Card
              title="A backup whenever you want one"
              body="Every client, invoice and line item in a single file, from the dashboard or by asking. Keep it wherever you trust."
            />
          </div>
        </Section>

        {/* Manual */}
        <Section
          eyebrow="Or do it yourself"
          title="The AI is optional. The system is not."
          lead="Underneath the assistants sits a complete billing dashboard. Anything an AI can do, you can do by hand, and the two work on exactly the same records."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card
              title="Raise invoices by hand"
              body="Pick a client and the price and service fill themselves in. Add a line for every extra the job needed and watch the total build."
            />
            <Card
              title="Change anything, later"
              body="Fix a date, a price or a line on an invoice already raised. Cancel one that went out wrong, or delete one that should never have existed."
            />
            <Card
              title="Manage your clients"
              body="Add new ones, update an address, set the rate you charge each of them. Future invoices pick it up automatically."
            />
            <Card
              title="Keep the books current"
              body="Mark an invoice paid the moment the money lands, and every total on your dashboard moves with it."
            />
          </div>
        </Section>

        {/* Safety */}
        <Section
          eyebrow="Safety"
          title="Built to hand an agent the keys"
          lead="Letting software raise invoices only works if the rules sit underneath it. These are enforced by the system itself, not by asking the AI nicely."
        >
          <ul className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
            <Guard
              title="Only you can see your data"
              detail="Access is locked at the database engine. Every read and write happens on the server with a key the browser never receives."
            />
            <Guard
              title="Every business is on its own"
              detail="Your records are separated at the database level, not by a filter in the code. One business can never read another's."
            />
            <Guard
              title="Two invoices can never share a number"
              detail="Numbering is handed out by the database one at a time, so you and an agent working the same second still get different numbers."
            />
            <Guard
              title="The AI asks before it deletes"
              detail="Every other action can be undone. Deleting an invoice is the one thing that needs a human yes first."
            />
            <Guard
              title="Every agent has its own key"
              detail="Each assistant gets a key you hand out and can take back on its own. Retire one and the rest keep working, untouched."
            />
            <Guard
              title="Invoices you already sent never change"
              detail="The price, the address and the tax details are captured onto the invoice the day it goes out. Changing them affects what you bill next, never what you billed."
            />
            <Guard
              title="No passwords to steal"
              detail="You sign in with Google. The system stores no passwords at all."
            />
            <Guard
              title="Your numbers cannot go stale"
              detail="Balances and overdue dates are worked out the moment you look at them, rather than saved once and left to drift."
            />
            <Guard
              title="Nothing left lying around"
              detail="Invoices and statements are built when you ask and discarded after. There is no folder of sensitive files waiting to leak."
            />
          </ul>
        </Section>

        {/* Close */}
        <section className="border-t border-slate-200 py-16 dark:border-slate-800">
          <Reveal>
            <h2 className="max-w-2xl text-2xl font-bold tracking-tight sm:text-3xl">
              Set up your business and let your AI do the billing.
            </h2>
            <div className="mt-7 w-full max-w-xs">
              <LoginButton />
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-slate-200 py-10 dark:border-slate-800">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 text-sm text-slate-400">
          <span>
            &copy; {new Date().getFullYear()} AI Billing System. All rights
            reserved.
          </span>
          <div className="flex items-center gap-1">
            <a
              href="https://cv.andreshenao.com.au/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 rounded-lg px-2 py-1 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-900 dark:hover:text-slate-200"
            >
              <span>Built by Andres Henao</span>
              {/* Two files, one hidden per theme. Swapping in JS would flash. */}
              <Image
                src="/logo_ah_black.png"
                alt=""
                width={26}
                height={26}
                className="dark:hidden"
              />
              <Image
                src="/logo_ah_white.png"
                alt=""
                width={26}
                height={26}
                className="hidden dark:block"
              />
            </a>
            <a
              href="https://www.linkedin.com/in/andreshenao/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Andres Henao on LinkedIn"
              className="rounded-lg p-2 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-900 dark:hover:text-slate-200"
            >
              <svg
                className="h-5 w-5"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9h4v12H3V9Zm7 0h3.8v1.64h.05c.53-.95 1.83-1.95 3.76-1.95 4.02 0 4.76 2.5 4.76 5.76V21h-4v-5.8c0-1.38-.03-3.16-2-3.16-2 0-2.31 1.5-2.31 3.06V21h-4V9Z" />
              </svg>
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

/**
 * The shape of the thing, in one picture: many agents, one door, one set of
 * records. It is the sentence the rest of the page spends its time explaining.
 */
function Diagram() {
  const agents = [
    "Claude Code",
    "Claude Desktop",
    "Codex",
    "Copilot CLI",
    "Gemini",
    "Cursor",
    "Hermes",
    "OpenClaw",
  ];
  return (
    <div className="mt-14 rounded-3xl bg-slate-50 p-6 ring-1 ring-slate-200 sm:p-8 dark:bg-slate-900/60 dark:ring-slate-800">
      <div className="flex flex-wrap justify-center gap-2">
        {agents.map((a) => (
          <span
            key={a}
            className="rounded-xl bg-white px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:text-slate-900 hover:ring-slate-400 dark:bg-slate-950 dark:text-slate-300 dark:ring-slate-800 dark:hover:text-slate-100 dark:hover:ring-slate-600"
          >
            {a}
          </span>
        ))}
      </div>

      <div className="mx-auto mt-4 h-6 w-px bg-slate-300 dark:bg-slate-700" />

      <div className="mx-auto max-w-sm rounded-xl bg-slate-900 px-4 py-3 text-center dark:bg-slate-100">
        <p className="text-sm font-semibold text-white dark:text-slate-900">
          One gateway, one key each
        </p>
        <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
          MCP and REST · rules enforced here
        </p>
      </div>

      <div className="mx-auto mt-4 h-6 w-px bg-slate-300 dark:bg-slate-700" />

      <p className="text-center text-sm font-medium text-slate-600 dark:text-slate-400">
        Your clients, invoices and history
      </p>
    </div>
  );
}

function Section({
  id,
  eyebrow,
  title,
  lead,
  children,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-20 border-t border-slate-200 py-16 dark:border-slate-800"
    >
      <Reveal>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
          {eyebrow}
        </p>
        <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
          {title}
        </h2>
        {lead && (
          <p className="mt-3 max-w-2xl text-slate-600 dark:text-slate-400">
            {lead}
          </p>
        )}
      </Reveal>
      <Reveal delay={80} className="mt-8">
        {children}
      </Reveal>
    </section>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <li className="lift rounded-2xl bg-slate-50 p-6 dark:bg-slate-900">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white dark:bg-slate-100 dark:text-slate-900">
        {n}
      </span>
      <h3 className="mt-4 font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
        {body}
      </p>
    </li>
  );
}

function Card({ title, body }: { title: string; body: string }) {
  return (
    <div className="lift rounded-2xl p-6 ring-1 ring-slate-200 hover:ring-slate-300 dark:ring-slate-800 dark:hover:ring-slate-700">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
        {body}
      </p>
    </div>
  );
}

/** One side of the assistant / agent distinction. */
function Compare({
  kind,
  names,
  points,
  highlight,
}: {
  kind: string;
  names: string;
  points: string[];
  /** The autonomous side, drawn as the fuller option rather than the default one. */
  highlight?: boolean;
}) {
  return (
    <div
      className={`lift rounded-2xl p-6 ${
        highlight
          ? "bg-slate-900 text-slate-100 ring-1 ring-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:ring-slate-100"
          : "ring-1 ring-slate-200 dark:ring-slate-800"
      }`}
    >
      <h3 className="text-lg font-semibold">{kind}</h3>
      <p className="mt-1 text-xs font-medium text-slate-400 dark:text-slate-500">
        {names}
      </p>
      <ul className="mt-4 space-y-2.5">
        {points.map((p) => (
          <li key={p} className="flex gap-2.5 text-sm leading-relaxed">
            <span
              aria-hidden="true"
              className="mt-2 h-1 w-1 shrink-0 rounded-full bg-current opacity-50"
            />
            <span
              className={
                highlight
                  ? "text-slate-200 dark:text-slate-800"
                  : "text-slate-600 dark:text-slate-400"
              }
            >
              {p}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Plain-language headline for everyone, implementation underneath for the curious. */
function Guard({ title, detail }: { title: string; detail: string }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="mt-1 shrink-0 text-slate-900 dark:text-slate-100"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 12 12" fill="currentColor">
          <path d="M4.5 9.2 1.3 6l1-1 2.2 2.2L9.7 2l1 1z" />
        </svg>
      </span>
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
          {detail}
        </p>
      </div>
    </li>
  );
}
