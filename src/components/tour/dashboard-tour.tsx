"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { finishTourAction } from "./tour-actions";

/**
 * The welcome tour: the real dashboard, with a light on one part of it at a
 * time.
 *
 * The first version of this was a sequence of pages that replaced the
 * dashboard, so the one thing a new arrival wanted (to see what they had signed
 * up to) was the one thing it hid. This one darkens the screen, cuts a hole
 * around the thing being explained, and puts a bubble next to it. Everything
 * behind stays where it is, at zero, which is exactly what a new business is.
 *
 * Steps point at DOM nodes by `data-tour` rather than at components, so a step
 * whose target is not on this screen is skipped instead of breaking: the
 * "let your AI bill for you" card, for instance, only exists on trial accounts.
 */

type Step = {
  /** The `data-tour` value to point at. */
  target: string;
  title: string;
  body: string;
};

const STEPS: Step[] = [
  {
    target: "business",
    title: "Start here: who is invoicing",
    body: "Your name, your ABN and how you get paid. It is printed at the top of every invoice, and it is the one thing the rest of the dashboard cannot work without.",
  },
  {
    target: "totals",
    title: "What you are owed, at a glance",
    body: "Money still out, split into overdue and still within your terms. This is the page you leave open.",
  },
  {
    target: "nav-invoices",
    title: "A new invoice takes two minutes",
    body: "Pick a client, say what the work was and when you did it, and save. The number is assigned on save and the PDF is made on demand, never stored.",
  },
  {
    target: "nav-clients",
    title: "Who you bill",
    body: "A name and an address is enough to invoice somebody. If you agree a price with each client instead, you can turn that on in Business details.",
  },
  {
    target: "nav-history",
    title: "Everything you have issued",
    body: "Unpaid on top, paid and cancelled below. Mark one paid, correct one, cancel one. A price change never rewrites an invoice already sent.",
  },
  {
    target: "nav-statements",
    title: "Reminders and tax time",
    body: "What one client still owes, ready to send, and a financial year statement per ABN for your accountant.",
  },
  {
    target: "ai",
    title: "Let your AI do the billing",
    body: "Connect Claude, Codex or any other assistant with one key and ask it to invoice for you. It works through the same rules as this dashboard.",
  },
  {
    target: "backup",
    title: "It is your data",
    body: "Download everything in one file whenever you like, and the guide has the steps to run this whole thing on your own accounts, for free.",
  },
];

/**
 * The browser's memory of the tour, for the stretch before a business exists.
 *
 * Keyed by person, never global: one browser is used by more than one account
 * (signing up a second business, testing, a shared laptop), and a single key
 * meant the first arrival switched the tour off for everybody after them.
 */
const seenKey = (userId: string) => `awesome:tour-seen:${userId}`;

/** Fired by the "See the tour again" button on the overview. */
export const TOUR_EVENT = "awesome:tour";

export function DashboardTour({
  hasOrg,
  done,
  userId,
}: {
  /** Whether the business exists yet. Without one, only step 1 can be acted on. */
  hasOrg: boolean;
  /** Whether THIS person has already been through it. */
  done: boolean;
  /** Who is looking. The tour is per person, not per browser and not per business. */
  userId: string;
}) {
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<DOMRect | null>(null);
  const bubble = useRef<HTMLDivElement>(null);

  const start = useCallback(() => {
    // Only the steps whose target is actually on the page. Filtered once, at
    // the start, so the numbering does not change under the reader's feet.
    const present = STEPS.filter((s) =>
      document.querySelector(`[data-tour="${s.target}"]`),
    );
    if (present.length === 0) return;
    setSteps(present);
    setIndex(0);
  }, []);

  // Auto-start on the first visit, and never again once it has been seen.
  useEffect(() => {
    if (done) return;
    if (window.localStorage.getItem(seenKey(userId)) === "1") {
      // Seen while there was still nowhere to record it. Now there is.
      if (hasOrg) void finishTourAction();
      return;
    }
    // One frame later: the page under this component has to be laid out before
    // we can ask which of the targets exist and where they are.
    const frame = requestAnimationFrame(start);
    return () => cancelAnimationFrame(frame);
  }, [done, hasOrg, start, userId]);

  // The replay button lives on the overview, several components away, so it
  // asks through the window rather than through props.
  useEffect(() => {
    const replay = () => start();
    window.addEventListener(TOUR_EVENT, replay);
    return () => window.removeEventListener(TOUR_EVENT, replay);
  }, [start]);

  const close = useCallback(() => {
    setSteps(null);
    setBox(null);
    window.localStorage.setItem(seenKey(userId), "1");
    if (hasOrg) void finishTourAction();
  }, [hasOrg, userId]);

  const step = steps?.[index];

  // Follow the target: it moves while the page scrolls to it, and again if the
  // window is resized. Cheap, and it means no step can end up pointing at a
  // rectangle where its element used to be.
  useEffect(() => {
    if (!step) return;
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    if (!el) return;

    el.scrollIntoView({ block: "center", behavior: "smooth" });
    const measure = () => setBox(el.getBoundingClientRect());
    const frame = requestAnimationFrame(measure);

    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [step]);

  // Keys people expect from anything that has a next button.
  useEffect(() => {
    if (!steps) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, steps.length - 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [steps, close]);

  useEffect(() => {
    bubble.current?.focus();
  }, [index, steps]);

  if (!steps || !step || !box) return null;

  const last = index === steps.length - 1;
  const pad = 8;
  // Below the target when there is room, above it when there is not. On a
  // phone the bubble is nearly the width of the screen either way.
  const below = box.bottom + 200 < window.innerHeight;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[60]"
      role="dialog"
      aria-modal="false"
      aria-label="Dashboard tour"
    >
      {/* The hole. One element with an enormous shadow is what darkens
          everything else, so the thing being explained keeps its own colours
          instead of being drawn twice. */}
      <div
        className="absolute rounded-xl ring-2 ring-white/70 transition-all duration-200 dark:ring-white/40"
        style={{
          top: box.top - pad,
          left: box.left - pad,
          width: box.width + pad * 2,
          height: box.height + pad * 2,
          boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.72)",
        }}
      />

      <div
        ref={bubble}
        tabIndex={-1}
        className="pointer-events-auto absolute w-[min(24rem,calc(100vw-2rem))] rounded-2xl bg-white p-5 shadow-2xl outline-none ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700"
        style={{
          top: below ? box.bottom + pad + 12 : undefined,
          bottom: below ? undefined : window.innerHeight - box.top + pad + 12,
          left: Math.min(
            Math.max(12, box.left),
            Math.max(12, window.innerWidth - 384 - 12),
          ),
        }}
      >
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
          {index + 1} of {steps.length}
        </p>
        <h2 className="mt-1 text-base font-bold text-slate-900 dark:text-slate-100">
          {step.title}
        </h2>
        <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
          {step.body}
        </p>

        {!hasOrg && index === 0 && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            Everything else stays switched off until your business exists.
          </p>
        )}

        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={close}
            className="text-xs font-medium text-slate-400 underline transition hover:text-slate-600 dark:hover:text-slate-300"
          >
            Skip
          </button>
          <div className="flex items-center gap-2">
            {index > 0 && (
              <button
                type="button"
                onClick={() => setIndex((i) => i - 1)}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 ring-1 ring-slate-300 transition hover:bg-slate-50 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={() => (last ? close() : setIndex((i) => i + 1))}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            >
              {last ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Bring the tour back, for anyone who skipped it or wants a reminder. */
export function ReplayTour() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(TOUR_EVENT))}
      className="text-sm font-medium text-slate-500 underline transition hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
    >
      See the tour again
    </button>
  );
}
