"use client";

import { useActionState, useState, useTransition } from "react";
import { createAgentKitAction, setStepAction, type KitState } from "./actions";

const initial: KitState = { ok: false };

/**
 * A step that the app can see for itself (a client exists, an invoice exists)
 * is never a checkbox: ticking a box to say something you already did is busy
 * work. Only the steps that happen outside the app are ticked by hand.
 */
export function Step({
  n,
  title,
  children,
  done,
  stepId,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
  done: boolean;
  /** Set for steps the app cannot observe, which the user ticks themselves. */
  stepId?: string;
}) {
  const [checked, setChecked] = useState(done);
  const [pending, start] = useTransition();

  function toggle() {
    if (!stepId) return;
    const next = !checked;
    setChecked(next);
    start(async () => {
      await setStepAction(stepId, next);
    });
  }

  return (
    <div className="flex gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <div className="shrink-0">
        {stepId ? (
          <button
            type="button"
            onClick={toggle}
            disabled={pending}
            aria-pressed={checked}
            aria-label={`Mark step ${n} as done`}
            className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition ${
              checked
                ? "bg-emerald-600 text-white"
                : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
            }`}
          >
            {checked ? "✓" : n}
          </button>
        ) : (
          <span
            className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
              checked
                ? "bg-emerald-600 text-white"
                : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
            }`}
          >
            {checked ? "✓" : n}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100">
          {title}
        </h3>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * Minting the key and building the kit are one action on purpose: the raw key
 * exists only inside that request, so this is the only moment a downloadable
 * file and a paste-ready prompt can already contain it.
 */
export function AgentKit({ hasKey }: { hasKey: boolean }) {
  const [state, action, pending] = useActionState(createAgentKitAction, initial);
  const [copied, setCopied] = useState(false);

  function download(kit: NonNullable<KitState["kit"]>) {
    const binary = atob(kit.zip_base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const url = URL.createObjectURL(
      new Blob([bytes], { type: "application/zip" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = kit.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyPrompt(prompt: string) {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (state.kit) {
    const kit = state.kit;
    return (
      <div className="space-y-4">
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Your key was created and is inside the file below. It is shown this
          once and never again. Treat the file like a password: if it gets out,
          revoke the key on the Agent keys page and make a new one.
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => download(kit)}
            className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            Download {kit.filename}
          </button>
          <button
            type="button"
            onClick={() => copyPrompt(kit.prompt)}
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-700 ring-1 ring-slate-300 transition hover:bg-slate-50 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-800"
          >
            {copied ? "Copied" : "Copy the setup prompt"}
          </button>
        </div>

        <details className="rounded-xl bg-slate-50 p-4 dark:bg-slate-950/50">
          <summary className="cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-300">
            See the prompt
          </summary>
          <pre className="mt-3 overflow-x-auto text-xs whitespace-pre-wrap text-slate-600 dark:text-slate-400">
            {kit.prompt}
          </pre>
        </details>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3">
      {hasKey && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          You already have a key. Creating another is fine, one per assistant is
          the usual arrangement, and each can be revoked on its own.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
            Which assistant is this for?
          </span>
          <input
            name="label"
            placeholder="Claude, ChatGPT, my phone bot..."
            className="input"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
        >
          {pending ? "Building..." : "Create my key and kit"}
        </button>
      </div>
      {state.error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2">
      <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
        {text}
      </pre>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        className="text-xs font-medium text-slate-500 underline hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
