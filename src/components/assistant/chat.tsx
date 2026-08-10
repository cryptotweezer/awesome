"use client";

import { useEffect, useRef, useState } from "react";

type Message = {
  role: "user" | "assistant";
  content: string;
  usedTools?: string[];
};

/**
 * A working chat, not a demo one: whatever it says it did, it did, through the
 * same functions the dashboard forms use.
 *
 * No streaming in this first version. A billing answer is short and usually
 * comes after a couple of tool calls, so the wait is a second or two and the
 * added complexity of streaming through a tool loop buys very little.
 */
export function Chat({
  suggestions,
  remaining,
  storageKey,
}: {
  suggestions: string[];
  /** Messages left on a trial account, or null when there is no limit. */
  remaining: number | null;
  /**
   * Where this conversation is kept between pages and reloads. Keyed by
   * organisation, never global: signing in as a different business must not
   * show the previous one's conversation.
   */
  storageKey: string;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState<number | null>(remaining);
  const endRef = useRef<HTMLDivElement>(null);

  // Restored after mount rather than during render: the server has no
  // localStorage, and reading it while rendering would make the two disagree.
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      // Restoring a browser store on mount is what an effect is for: it cannot
      // be an initial value, because the server renders first and has none.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setMessages(JSON.parse(saved) as Message[]);
    } catch {
      // Unreadable or full: a lost conversation is not worth an error.
    }
    setRestored(true);
  }, [storageKey]);

  useEffect(() => {
    if (!restored) return; // never overwrite the saved copy with the empty one
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(messages));
    } catch {
      // Quota, private mode, whatever. The chat still works.
    }
  }, [messages, restored, storageKey]);

  function clear() {
    setMessages([]);
    setError(null);
  }

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || pending) return;

    const next = [...messages, { role: "user" as const, content: question }];
    setMessages(next);
    setInput("");
    setPending(true);
    setError(null);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(body.error ?? "Something went wrong.");
        if (res.status === 429) setLeft(0);
        return;
      }

      setMessages([
        ...next,
        {
          role: "assistant",
          content: body.content,
          usedTools: body.used_tools ?? [],
        },
      ]);
      if (typeof body.remaining === "number") setLeft(body.remaining);
    } catch {
      setError("Could not reach the assistant.");
    } finally {
      setPending(false);
    }
  }

  const exhausted = left !== null && left <= 0;

  return (
    // Fills whatever it is put in: the panel decides how big the chat is.
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        {messages.length === 0 && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Ask about your invoices, or tell me what to do. I can create
              invoices, mark them paid, build statements and answer questions
              about who owes what.
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  disabled={exhausted}
                  className="rounded-full px-3 py-1.5 text-sm text-slate-600 ring-1 ring-slate-300 transition hover:bg-slate-50 disabled:opacity-50 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <div
              className={`max-w-[85%] space-y-1.5 rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                  : "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100"
              }`}
            >
              <p>{m.content}</p>
              {m.usedTools && m.usedTools.length > 0 && (
                <p className="text-xs opacity-60">
                  {[...new Set(m.usedTools)].join(", ")}
                </p>
              )}
            </div>
          </div>
        ))}

        {pending && (
          <p className="text-sm text-slate-400 dark:text-slate-500">Working...</p>
        )}
        {error && (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex items-center gap-3 border-t border-slate-200 p-4 dark:border-slate-800"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            exhausted ? "No messages left on this account" : "Ask me anything"
          }
          disabled={pending || exhausted}
          className="input"
        />
        <button
          type="submit"
          disabled={pending || exhausted || !input.trim()}
          className="shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
        >
          Send
        </button>
      </form>

      <div className="flex items-start justify-between gap-3 px-4 pb-3">
        {left !== null ? (
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {left > 0
              ? `${left} assistant ${left === 1 ? "message" : "messages"} left on this trial account. Clearing the conversation does not give any back. Connecting your own AI removes the limit.`
              : "You have used the assistant messages that come with a trial account. Connect your own AI from the setup guide to keep going."}
          </p>
        ) : (
          <span />
        )}
        {messages.length > 0 && (
          <button
            type="button"
            onClick={clear}
            className="shrink-0 text-xs font-medium text-slate-400 underline transition hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
