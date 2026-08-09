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
}: {
  suggestions: string[];
  /** Messages left on a trial account, or null when there is no limit. */
  remaining: number | null;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState<number | null>(remaining);
  const endRef = useRef<HTMLDivElement>(null);

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
    <div className="flex h-[calc(100vh-14rem)] flex-col rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
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

      {left !== null && (
        <p className="px-4 pb-3 text-xs text-slate-400 dark:text-slate-500">
          {left > 0
            ? `${left} assistant ${left === 1 ? "message" : "messages"} left on this trial account. Connecting your own AI removes the limit.`
            : "You have used the assistant messages that come with a trial account. Connect your own AI from the setup guide to keep going."}
        </p>
      )}
    </div>
  );
}
