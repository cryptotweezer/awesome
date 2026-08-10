"use client";

import { useEffect, useState } from "react";
import { Chat } from "./chat";

/**
 * The assistant, reachable from every page instead of being a place you go.
 *
 * It used to be a tab, which meant leaving whatever you were doing to ask a
 * question about it. As a panel it sits over the page you are already on, and
 * the conversation survives navigation and reloads because it lives in
 * localStorage rather than in this component's state.
 *
 * Whether the panel is open is remembered too: somebody who works with it open
 * should not have to reopen it on every page.
 */
export function AssistantWidget({
  orgId,
  remaining,
  suggestions,
}: {
  orgId: string;
  remaining: number | null;
  suggestions: string[];
}) {
  const openKey = `awesome:assistant-open:${orgId}`;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      // The server renders first and has no localStorage, so this cannot be an
      // initial value; restoring after mount is the point of the effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(window.localStorage.getItem(openKey) === "1");
    } catch {
      // Nothing to restore, which is the same as closed.
    }
  }, [openKey]);

  function toggle(next: boolean) {
    setOpen(next);
    try {
      window.localStorage.setItem(openKey, next ? "1" : "0");
    } catch {
      // The panel still opens, it just forgets.
    }
  }

  // Escape closes it, the way every other overlay on the web does.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") toggle(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      {open && (
        <div
          role="dialog"
          aria-label="Assistant"
          className="fixed inset-x-3 bottom-3 z-50 flex h-[min(34rem,80vh)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 sm:inset-x-auto sm:right-5 sm:bottom-20 sm:w-[26rem] dark:bg-slate-900 dark:ring-slate-800"
        >
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Assistant
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Works on your real data
              </p>
            </div>
            <button
              type="button"
              onClick={() => toggle(false)}
              aria-label="Close the assistant"
              className="rounded-lg px-2 py-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              ✕
            </button>
          </div>

          <div className="min-h-0 flex-1">
            <Chat
              suggestions={suggestions}
              remaining={remaining}
              storageKey={`awesome:chat:${orgId}`}
            />
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => toggle(!open)}
        aria-expanded={open}
        className="fixed right-5 bottom-5 z-50 hidden items-center gap-2 rounded-full bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-slate-700 sm:flex dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
      >
        {open ? "Hide assistant" : "Ask the assistant"}
      </button>

      {/* On a phone the panel already covers the screen, so the launcher only
          has room to be a circle, and it hides while the panel is open. */}
      {!open && (
        <button
          type="button"
          onClick={() => toggle(true)}
          aria-label="Open the assistant"
          className="fixed right-4 bottom-4 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-lg text-white shadow-lg sm:hidden dark:bg-slate-100 dark:text-slate-900"
        >
          ✦
        </button>
      )}
    </>
  );
}
