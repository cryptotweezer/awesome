import Image from "next/image";
import { ThemeToggle } from "@/components/theme-toggle";
import { isGuestSignupEnabled } from "@/lib/auth";
import { appBaseUrl } from "@/lib/app-url";
import { LoginButton } from "./login-button";
import { ChatDemo } from "./chat-demo";
import { Reveal, ScrollProgress, SectionLinks, CopyLine } from "./motion";

/**
 * The public page. It sells a service, so it says what the thing does for the
 * reader and stops there: no rationale for how it was built, no clauses
 * defending against objections nobody raised, no numbers that go stale (the
 * trial's allowances are on the dashboard from the first screen).
 *
 * Order is the argument. Connecting your own AI comes first, because that is
 * the reason to choose this over any other billing app, then the agents that
 * run on their own, then the assistant built in for somebody who has neither.
 *
 * The distinction between those two is the thing people get wrong, so it gets
 * its own section. An assistant you drive (Claude, Codex, Copilot, Gemini)
 * connects with one line and approves in the browser, and works while you are
 * there. An agent (Hermes, OpenClaw) connects the same way, and everything
 * extra it does, sending the email, waking on a schedule, answering your
 * phone, comes from that agent's own setup, never from here.
 */

const MESSAGES: Record<string, string> = {
  unauthorized: "That Google account is not on the list for this deployment.",
  auth: "Something went wrong while signing in. Please try again.",
  blocked: "Too many sign-in attempts from here. Wait a minute and try again.",
};

/**
 * The public copy of this system, for somebody who would rather run it on their
 * own hosting and their own database. It carries none of Awesome, no demo
 * account and no trial: the schema is named for what it does, anybody who signs
 * in owns their business outright, and nothing is ever purged.
 *
 * Set back to null and the section below returns to saying the repository is on
 * its way. Nothing else on the page needs touching either way.
 */
const REPO_URL: string | null =
  "https://github.com/cryptotweezer/AI_billing_service";

const NAV = [
  { id: "connect", label: "Connect your AI" },
  { id: "agents", label: "Agents" },
  { id: "assistant", label: "Built in" },
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

      <header className="sticky top-0 z-20 border-b border-hairline bg-white/70 backdrop-blur-xl dark:bg-slate-950/70">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <a href="#top" className="flex shrink-0 items-center gap-2.5">
            {/* Two files, one hidden per theme. Swapping in JS would flash. */}
            <Image
              src="/logo_ah_black.png"
              alt=""
              width={28}
              height={28}
              className="dark:hidden"
              priority
            />
            <Image
              src="/logo_ah_white.png"
              alt=""
              width={28}
              height={28}
              className="hidden dark:block"
              priority
            />
            <span className="text-[15px] font-semibold tracking-tight">
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

      <main id="top">
        {/* Hero. The grid and the wash of colour sit in their own absolutely
            positioned layer, so everything below stays plain. */}
        <section className="relative isolate overflow-hidden">
          <div
            aria-hidden="true"
            className="grid-bg pointer-events-none absolute inset-0 -z-10"
          />
          <div
            aria-hidden="true"
            className="aurora pointer-events-none absolute inset-x-0 -top-40 -z-10 h-[36rem]"
          />

          <div className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
            <Reveal>
              <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-hairline bg-white/70 px-3.5 py-1.5 text-xs font-medium text-slate-600 backdrop-blur dark:bg-white/5 dark:text-slate-300">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </span>
                Works with the AI you already use
              </p>
              <h1 className="max-w-4xl text-[2.75rem] leading-[1.02] font-semibold tracking-[-0.03em] text-balance sm:text-6xl lg:text-7xl">
                Invoicing an AI can{" "}
                <span className="text-accent">actually run.</span>
              </h1>
              <p className="mt-7 max-w-2xl text-lg leading-relaxed text-pretty text-slate-600 sm:text-xl dark:text-slate-400">
                Tell an AI to bill the job and it is billed. Invoices,
                reminders, client statements and your whole financial year, from
                a sentence. Bring the AI you already use, or use the one built
                in.
              </p>
            </Reveal>

            {message && (
              <div className="mt-8 max-w-md rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900">
                {message}
              </div>
            )}

            <Reveal delay={80}>
              <div className="mt-10 flex flex-wrap items-center gap-3">
                <div className="w-full max-w-xs">
                  <LoginButton />
                </div>
                <a
                  href="#connect"
                  className="group inline-flex items-center gap-2 rounded-xl border border-hairline px-4 py-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white"
                >
                  See how it connects
                  <span className="transition group-hover:translate-y-0.5">
                    ↓
                  </span>
                </a>
              </div>

              {/* Only promised when it is actually true. Signing up is opened by
                  the GUEST_SIGNUP environment variable, not by this deploy. */}
              {signupOpen && (
                <p className="mt-5 max-w-xl text-sm text-slate-500 dark:text-slate-400">
                  Free to try with your own business details. Sign in with
                  Google and you are billing a minute later.
                </p>
              )}
            </Reveal>

            <Reveal delay={140}>
              <Diagram />
            </Reveal>
          </div>
        </section>

        <div className="mx-auto max-w-6xl px-6">
          {/* Connect your own AI. First section on the page on purpose: it is the
              reason to choose this over any other billing app. */}
          <Section
            id="connect"
            n="01"
            eyebrow="Your own AI"
            title="Bring the AI you already use"
            lead="One line to connect, one click to approve. Claude, Codex, Copilot, Gemini, Cursor: if it speaks MCP, it can bill for you."
          >
            <ol className="grid gap-4 sm:grid-cols-3">
              <Step
                n="1"
                title="Paste one line"
                body="It tells your assistant where your books live. Every assistant has its own line, and the app writes it for you."
              />
              <Step
                n="2"
                title="Approve it in your browser"
                body="You see which assistant is asking and what it will be able to do. Untick anything you would rather it could not."
              />
              <Step
                n="3"
                title="Ask it for something"
                body={`"What am I owed?" is the usual first question. Nothing to set up first: it reads how your business works on its own.`}
              />
            </ol>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="lift surface rounded-2xl p-6">
                <h3 className="font-semibold">The whole connection</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  This is Claude Code. Codex, Claude Desktop and everything else
                  get their own line inside the app.
                </p>
                <div className="mt-4">
                  <CopyLine
                    text={`claude mcp add --transport http billing \\\n  ${baseUrl}/api/mcp --scope user`}
                  />
                </div>
              </div>

              <div className="lift surface rounded-2xl p-6">
                <h3 className="font-semibold">It only ever touches billing</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  Your clients and your invoices, nothing else. You decide
                  whether an assistant can look, or also create and edit, or
                  also delete. Cutting one off takes a second and the rest keep
                  working.
                </p>
              </div>
            </div>
          </Section>

          {/* Autonomous agents */}
          <Section
            id="agents"
            n="02"
            eyebrow="Agents"
            title="Or let an agent run it while you work"
            lead="An assistant works while you are in front of it. An agent lives on a machine of its own, with its own inbox and its own schedule, and answers you in your messaging app."
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <Compare
                kind="Assistants you drive"
                names="Claude Code · Claude Desktop · Codex · Copilot CLI · Gemini · Cursor"
                points={[
                  "You ask, it does it, the file lands in your chat.",
                  "Runs where you already work: your terminal, your editor, your desktop.",
                  "Nothing happens while you are away, which is often what you want.",
                ]}
              />
              <Compare
                kind="Agents that run by themselves"
                names="Hermes · OpenClaw · anything self-hosted"
                points={[
                  "Answers you from your phone, in the messaging app you already use.",
                  "Sends the invoice to your client from its own email.",
                  "Bills on the 1st and chases on Monday without being asked.",
                ]}
                highlight
              />
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Card
                title="Invoices that send themselves"
                body="The app writes it, the agent emails it. Your client gets the bill without you opening a laptop."
              />
              <Card
                title="Billing on a schedule"
                body="The monthly invoices on the 1st, the overdue chase on Monday morning, the tax statement in July."
              />
              <Card
                title="Work you never see"
                body="It watches what is falling behind and tells you, instead of waiting to be asked."
              />
            </div>

            <p className="mt-6 max-w-2xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              How far an agent goes is up to how you set it up. The billing
              rules underneath never move, whichever one is asking.
            </p>

            <div className="mt-12">
              <h3 className="text-lg font-semibold">A morning, handled</h3>
              <p className="mt-2 max-w-2xl text-slate-600 dark:text-slate-400">
                The parts you would otherwise sit down for, done before you
                finish your coffee.
              </p>
              <div className="mt-6">
                <ChatDemo />
              </div>
            </div>
          </Section>

          {/* The dashboard assistant */}
          <Section
            id="assistant"
            n="03"
            eyebrow="Built in"
            title="No AI of your own? One is already inside"
            lead="It sits in the dashboard and does the same work on the same records, so whatever it says it did shows up a second later."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Card
                title="Bill from a sentence"
                body={`"Invoice Wave Tech for yesterday's job, $150." It works out the client, the rate, the day the work was done and the due date, and asks when it is not sure.`}
              />
              <Card
                title="Answer the money questions"
                body="Who owes you, what is overdue and by how long, what you billed this year, how much GST you have collected."
              />
              <Card
                title="Hand you the documents"
                body="An invoice, a client statement or your whole financial year, ready to open and send."
              />
              <Card
                title="In your own language"
                body="Write to it in any language. Say yesterday or last Tuesday and it lands on the right day."
              />
            </div>
          </Section>

          {/* Output */}
          <Section
            n="04"
            eyebrow="What you get"
            title="Everything your books need"
            lead="Ask for it, or click for it. There is a full dashboard underneath: raise, edit, cancel and mark paid by hand whenever you would rather."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Card
                title="Invoices, ready to send"
                body="Numbered, filed and printed with your logo the second you ask for one."
              />
              <Card
                title="Reminders that write themselves"
                body="One statement per client with everything they still owe, the moment an account falls behind."
              />
              <Card
                title="Tax time, sorted"
                body="A full financial year in a single file you hand straight to your accountant."
              />
              <Card
                title="Your data, whenever"
                body="Every client and invoice as an Excel workbook or a JSON file, in one click."
              />
            </div>
          </Section>

          {/* Safety */}
          <Section
            n="05"
            eyebrow="Safety"
            title="Built to hand an AI the keys"
            lead="The rules that keep the numbers right live in the system, not in a prompt."
          >
            <ul className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
              <Guard
                title="Only you reach your books"
                detail="Every read and write happens on the server, with a key your browser never sees."
              />
              <Guard
                title="Two invoices never share a number"
                detail="Numbers are handed out one at a time, so you and an agent asking in the same second still get different ones."
              />
              <Guard
                title="It asks before it deletes"
                detail="Everything else can be undone. Deleting an invoice needs a human yes first."
              />
              <Guard
                title="Invoices you sent never change"
                detail="The price, the address and the tax details are frozen the day it goes out. Change them and only future invoices move."
              />
              <Guard
                title="Every AI has its own key"
                detail="Cut one off and it stops immediately, with every other one still working."
              />
              <Guard
                title="No passwords to steal"
                detail="You sign in with Google. The system stores no passwords at all."
              />
            </ul>
          </Section>

          {/* Close */}
          <section className="pt-20">
            <Reveal>
              <div className="surface relative isolate overflow-hidden rounded-3xl px-8 py-14 text-center sm:px-14 sm:py-20">
                <div
                  aria-hidden="true"
                  className="aurora pointer-events-none absolute inset-x-0 -bottom-32 -z-10 h-72"
                />
                <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-[-0.02em] text-balance sm:text-4xl">
                  Set up your business and let your AI do the billing.
                </h2>
                <div className="mx-auto mt-9 w-full max-w-xs">
                  <LoginButton />
                </div>
              </div>
            </Reveal>
          </section>

          {/* Self-hosting */}
          <section className="py-20">
            <Reveal>
              <div className="surface rounded-3xl p-8 sm:p-10">
                <p className="flex items-center gap-2.5 text-xs font-medium tracking-[0.18em] text-slate-400 uppercase">
                  <span className="text-accent">Open source</span>
                  <span className="h-px w-5 bg-hairline" />
                  Run it yourself
                </p>
                <h2 className="mt-4 max-w-2xl text-2xl font-semibold tracking-[-0.02em] text-balance sm:text-3xl">
                  Or run it inside your own company
                </h2>
                <p className="mt-4 max-w-2xl leading-relaxed text-pretty text-slate-600 dark:text-slate-400">
                  Take the whole system, put it on your own hosting and your own
                  database, and it is yours: your branding, your rules, your
                  data, no limits and nothing expiring. Same dashboard, same
                  assistant, same door for every AI.
                </p>

                <div className="mt-7">
                  {REPO_URL ? (
                    <a
                      href={REPO_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700 hover:shadow-md dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                    >
                      Get the code
                      <span
                        aria-hidden="true"
                        className="transition group-hover:translate-x-0.5"
                      >
                        →
                      </span>
                    </a>
                  ) : (
                    <span className="inline-flex items-center gap-2 rounded-xl border border-hairline px-4 py-3 text-sm font-medium text-slate-500 dark:text-slate-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                      The public repository is on its way
                    </span>
                  )}
                </div>
              </div>
            </Reveal>
          </section>
        </div>
      </main>

      <footer className="border-t border-hairline py-10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-4 px-6 text-sm text-slate-500 dark:text-slate-400">
          <div>
            <span className="block">
              &copy; {new Date().getFullYear()} AI Billing System. All rights
              reserved.
            </span>
            {/* The two places to find the person who built it, under the line
                that says somebody did. Icons only: the byline opposite already
                carries the name. */}
            <div className="mt-2 -ml-2 flex items-center gap-1">
              <a
                href="https://www.linkedin.com/in/andreshenao/"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Andres Henao on LinkedIn"
                className="rounded-lg p-2 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-white/5 dark:hover:text-slate-100"
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
              <a
                href="https://cv.andreshenao.com.au/"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Andres Henao's website"
                className="rounded-lg p-2 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-white/5 dark:hover:text-slate-100"
              >
                <svg
                  className="h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M3 12h18" />
                  <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18Z" />
                </svg>
              </a>
            </div>
          </div>

          <a
            href="https://cv.andreshenao.com.au/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 rounded-lg px-2 py-1 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-white/5 dark:hover:text-slate-100"
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
    <div className="surface mx-auto mt-16 max-w-4xl rounded-3xl p-6 backdrop-blur-sm sm:p-10">
      <div className="mx-auto flex max-w-3xl flex-wrap justify-center gap-2">
        {agents.map((a) => (
          <span
            key={a}
            className="rounded-xl border border-hairline bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:-translate-y-0.5 hover:border-accent hover:text-slate-900 dark:bg-white/5 dark:text-slate-300 dark:hover:text-white"
          >
            {a}
          </span>
        ))}
      </div>

      <Wire />

      <div className="mx-auto max-w-sm rounded-2xl bg-slate-900 px-5 py-4 text-center shadow-lg shadow-slate-900/10 dark:bg-white">
        <p className="text-sm font-semibold text-white dark:text-slate-900">
          One gateway, one key each
        </p>
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
          MCP and REST · rules enforced here
        </p>
      </div>

      <Wire />

      <p className="text-center text-sm font-medium text-slate-500 dark:text-slate-400">
        Your clients, invoices and history
      </p>
    </div>
  );
}

/** The connector between two rungs of the diagram. */
function Wire() {
  return (
    <div
      aria-hidden="true"
      className="mx-auto my-5 h-8 w-px bg-gradient-to-b from-transparent via-slate-300 to-transparent dark:via-slate-600"
    />
  );
}

/**
 * A numbered section. On a wide screen the heading sits beside its cards and
 * stays there while they scroll, so the eye follows one column instead of
 * starting over at every band.
 */
function Section({
  id,
  n,
  eyebrow,
  title,
  lead,
  children,
}: {
  id?: string;
  n: string;
  eyebrow: string;
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-20 border-t border-hairline py-20 lg:grid lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] lg:gap-14"
    >
      <Reveal className="lg:sticky lg:top-24 lg:self-start">
        <p className="flex items-center gap-2.5 text-xs font-medium tracking-[0.18em] text-slate-400 uppercase">
          <span className="text-accent tabular-nums">{n}</span>
          <span className="h-px w-5 bg-hairline" />
          {eyebrow}
        </p>
        <h2 className="mt-4 text-2xl font-semibold tracking-[-0.02em] text-balance sm:text-3xl">
          {title}
        </h2>
        {lead && (
          <p className="mt-4 max-w-2xl leading-relaxed text-pretty text-slate-600 dark:text-slate-400">
            {lead}
          </p>
        )}
      </Reveal>
      <Reveal delay={80} className="mt-8 lg:mt-0">
        {children}
      </Reveal>
    </section>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <li className="lift surface rounded-2xl p-6">
      <span className="bg-accent-soft text-accent flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold">
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
    <div className="lift surface rounded-2xl p-6">
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
          ? "bg-slate-900 text-slate-100 shadow-lg shadow-slate-900/10 dark:bg-white dark:text-slate-900"
          : "surface"
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
                  ? "text-slate-200 dark:text-slate-700"
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
        className="bg-accent-soft text-accent mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
      >
        <svg className="h-3 w-3" viewBox="0 0 12 12" fill="currentColor">
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
