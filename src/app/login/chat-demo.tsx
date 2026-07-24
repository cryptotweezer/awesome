/**
 * Illustrative conversation with the agent. Static markup, no live data.
 * It exists to show what asking for something looks like in practice.
 */

type Line =
  | { from: "you"; text: string }
  | { from: "agent"; text: string; file?: string };

const CONVERSATION: Line[] = [
  { from: "you", text: "Who owes me money?" },
  {
    from: "agent",
    text: "4 clients, $2,340 outstanding. Two of them are past their payment term.",
  },
  { from: "you", text: "Invoice Sarah for the job on Tuesday" },
  {
    from: "agent",
    text: "Done. Invoice #1954 for $180.00, due 31 July.",
    file: "Invoice-1954-Sarah.pdf",
  },
  { from: "you", text: "How much did I bill in June?" },
  { from: "agent", text: "$8,410 across 22 invoices." },
  { from: "you", text: "Send Mark a reminder for what he still owes" },
  {
    from: "agent",
    text: "Statement ready. 3 unpaid invoices, $620.00 in total.",
    file: "Statement-Mark.pdf",
  },
];

const MORE = [
  "What are the last invoices for Acme?",
  "Prepare my tax statement for last financial year",
  "Mark invoice 1948 as paid",
  "Who has gone past their due date?",
  "What have I billed this year?",
];

export function ChatDemo() {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <div className="overflow-hidden rounded-2xl ring-1 ring-slate-200 dark:ring-slate-800">
        <div className="flex items-center gap-2.5 border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white dark:bg-slate-100 dark:text-slate-900">
            H
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold">Hermes</p>
            <p className="text-xs text-slate-400">online</p>
          </div>
        </div>

        <div className="space-y-3 bg-white p-4 dark:bg-slate-950 sm:p-6">
          {CONVERSATION.map((line, i) =>
            line.from === "you" ? (
              <div key={i} className="flex justify-end">
                <p className="max-w-[80%] rounded-2xl rounded-br-sm bg-slate-900 px-4 py-2.5 text-sm text-white dark:bg-slate-100 dark:text-slate-900">
                  {line.text}
                </p>
              </div>
            ) : (
              <div key={i} className="flex justify-start">
                <div className="max-w-[80%] rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-2.5 dark:bg-slate-900">
                  <p className="text-sm text-slate-700 dark:text-slate-300">
                    {line.text}
                  </p>
                  {line.file && (
                    <span className="mt-2.5 flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-medium text-slate-600 ring-1 ring-slate-200 dark:bg-slate-950 dark:text-slate-300 dark:ring-slate-800">
                      <svg
                        className="h-4 w-4 shrink-0"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <path d="M14 2v6h6" />
                      </svg>
                      {line.file}
                    </span>
                  )}
                </div>
              </div>
            ),
          )}
        </div>
      </div>

      <div>
        <p className="text-sm font-semibold">And anything else you need</p>
        <ul className="mt-4 space-y-2">
          {MORE.map((q) => (
            <li
              key={q}
              className="rounded-xl bg-slate-50 px-4 py-2.5 text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-400"
            >
              {q}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
