import Image from "next/image";
import { ThemeToggle } from "@/components/theme-toggle";
import { LoginButton } from "./login-button";
import { ChatDemo } from "./chat-demo";

const MESSAGES: Record<string, string> = {
  unauthorized:
    "That Google account is not authorised for Awesome Services billing.",
  auth: "Something went wrong while signing in. Please try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message = error ? MESSAGES[error] : null;

  return (
    <>
      <div className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/85 backdrop-blur dark:border-slate-800 dark:bg-slate-950/85">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
            <div className="flex items-center gap-2.5">
              {/* Two files, one hidden per theme. Swapping in JS would flash. */}
              <Image
                src="/logo_black.png"
                alt="Awesome Services"
                width={30}
                height={30}
                className="dark:hidden"
                priority
              />
              <Image
                src="/logo_white.png"
                alt=""
                width={30}
                height={30}
                className="hidden dark:block"
                priority
              />
              <span className="text-base font-bold tracking-tight">
                Awesome Services
              </span>
              <span className="text-xs text-slate-400">Billing</span>
            </div>

            <div className="flex items-center gap-2">
              <ThemeToggle />
              <LoginButton compact />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-6">
          {/* Hero */}
          <section className="py-20 sm:py-28">
            <h1 className="max-w-3xl text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
              Invoicing an AI can actually run.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-600 dark:text-slate-400">
              Raise an invoice, find out who owes you, chase what is late and
              get your tax paperwork ready, all by asking for it. Whatever AI
              assistant you already talk to can do the work, and every record
              lands in the same place.
            </p>

            {message && (
              <div className="mt-8 max-w-md rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900">
                {message}
              </div>
            )}

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <div className="w-full max-w-xs">
                <LoginButton />
              </div>
              <a
                href="#ask"
                className="rounded-lg px-4 py-3 text-sm font-medium text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900"
              >
                See it in action ↓
              </a>
            </div>
          </section>

          {/* The chat */}
          <Section
            id="ask"
            eyebrow="Ask"
            title="Run the whole thing from a chat"
            lead="Hermes is a personal AI assistant that lives inside your messaging app, so your books are one message away wherever you happen to be. Talk to it the way you would talk to a bookkeeper: it does the work and hands the finished file straight back."
          >
            <ChatDemo />

            <div className="mt-12">
              <h3 className="text-lg font-semibold">
                And Hermes is only one way in
              </h3>
              <p className="mt-2 max-w-2xl text-slate-600 dark:text-slate-400">
                Your books are not locked to a single assistant. Any AI you
                connect to them can do the same work, using the same rules.
              </p>

              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Card
                  title="Hermes, on your phone"
                  body="Message it on the way to a job and the answer comes back in the chat, file attached."
                />
                <Card
                  title="Claude and Codex"
                  body="The assistants already open on your desktop or in your terminal. Same books, nothing to configure per tool."
                />
                <Card
                  title="Any AI over MCP"
                  body="Point a new assistant at your database through MCP and it can raise invoices and answer questions from day one."
                />
                <Card
                  title="Built for whatever comes next"
                  body="The rules live with your data, not inside one assistant, so a better AI next year inherits all of them for free."
                />
              </div>

              <div className="mt-6 rounded-2xl bg-slate-50 p-6 dark:bg-slate-900">
                <h3 className="font-semibold">It sends the email, too</h3>
                <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  Ask it to send and the invoice or the reminder goes straight
                  to your client&apos;s inbox, with the document attached. From
                  the moment you ask to the moment your client reads it, you do
                  not open a single file. That is the whole point: end to end,
                  with you only saying what you want.
                </p>
              </div>
            </div>
          </Section>

          {/* How it works */}
          <Section
            eyebrow="How it works"
            title="Three steps, no forms to fill in"
          >
            <ol className="grid gap-4 sm:grid-cols-3">
              <Step
                n="1"
                title="Just ask"
                body="Say it the way you would say it out loud. From a chat on your phone, a desktop assistant, or the terminal you already work in."
              />
              <Step
                n="2"
                title="It gets done"
                body="The invoice is raised, numbered and filed against the right client, with the price locked in exactly as it stood that day."
              />
              <Step
                n="3"
                title="You get the file"
                body="A finished document comes straight back, ready to send to your client. Nothing to format, nothing to save."
              />
            </ol>

            <div className="mt-6 rounded-2xl p-6 ring-1 ring-slate-200 dark:ring-slate-800">
              <h3 className="font-semibold">
                And every one of them is filed for you
              </h3>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                Nothing an assistant does disappears into a chat window. Every
                invoice it raises lands in a dashboard you can open whenever you
                want: search your full history, see who has paid and who has
                not, open any invoice, edit it, and print it again years later.
                Ask from your phone, check it from your desk.
              </p>
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
                title="Invoices, ready to send"
                body="Numbered, filed and printed the second you ask for one. Send it straight to your client from wherever you asked."
              />
              <Card
                title="Your whole billing history"
                body="Every invoice you have ever raised, in one list you can filter by client, status, date or business. No more spreadsheets."
              />
              <Card
                title="Reminders that write themselves"
                body="One statement per client showing everything they still owe, ready to send the moment an account starts falling behind."
              />
              <Card
                title="Tax time, already sorted"
                body="A full financial year of invoices for one business, in a single file you can hand straight to your accountant."
              />
              <Card
                title="Know where you stand"
                body="What you are owed, what has gone past its due date and what you have billed this year, updated the instant anything changes."
              />
              <Card
                title="Clients that stay current"
                body="Rates, addresses and details in one place. Change them once and every future invoice picks them up."
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
                title="Two invoices can never share a number"
                detail="Numbering is handed out by the database one at a time, so a person and an agent working at the same second still get different numbers."
              />
              <Guard
                title="The AI asks before it deletes"
                detail="Every other action can be undone. Deleting an invoice is the one thing that needs a human yes first."
              />
              <Guard
                title="Invoices you already sent never change"
                detail="The price is captured onto the invoice the day it goes out. Updating what a client pays from now on leaves the old ones untouched."
              />
              <Guard
                title="No passwords to steal"
                detail="You sign in with a Google account that is on the list. The system stores no passwords at all."
              />
              <Guard
                title="Your numbers cannot go stale"
                detail="Balances and overdue dates are worked out the moment you look at them, rather than saved once and left to drift."
              />
              <Guard
                title="Walled off from everything else"
                detail="The billing data sits in its own isolated space and cannot reach, or be reached by, anything else sharing the same server."
              />
              <Guard
                title="Nothing left lying around"
                detail="Invoices and statements are built when you ask and discarded after. There is no folder of sensitive files waiting to leak."
              />
            </ul>
          </Section>
        </main>

        <footer className="mt-10 border-t border-slate-200 py-10 dark:border-slate-800">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 text-sm text-slate-400">
            <span>Awesome Services billing system.</span>
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
          </div>
        </footer>
      </div>
    </>
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
      <div className="mt-8">{children}</div>
    </section>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <li className="rounded-2xl bg-slate-50 p-6 dark:bg-slate-900">
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
    <div className="rounded-2xl p-6 ring-1 ring-slate-200 dark:ring-slate-800">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
        {body}
      </p>
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
