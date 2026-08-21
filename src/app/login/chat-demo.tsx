/**
 * Illustrative conversation with the agent. Static markup, no live data.
 * It exists to show what asking for something looks like in practice.
 */

type Line =
  | { from: "you"; text: string }
  | { from: "agent"; text: string; file?: string };

const CONVERSATION: Line[] = [
  { from: "you", text: "Morning! Who still owes me money?" },
  {
    from: "agent",
    text: "Morning! You have 4 clients with open invoices, $2,340 in total, and 2 of them are past their due date. Want me to chase those?",
  },
  { from: "you", text: "Yes please, send Mark a reminder for what he owes" },
  {
    from: "agent",
    text: "Sent Mark a friendly reminder, with his statement attached, 3 unpaid invoices, $620.00 in total.",
    file: "Statement-Mark.pdf",
  },
  {
    from: "you",
    text: "Great. Can you invoice Sarah for Tuesday's job and email it to her?",
  },
  {
    from: "agent",
    text: "All done, Invoice #0034 for $180.00, due 31 July. I emailed it straight to Sarah.",
    file: "Invoice-0034-Sarah.pdf",
  },
  { from: "you", text: "How did we do this month?" },
  {
    from: "agent",
    text: "Nice month, $8,410 billed across 22 invoices, and $6,900 already paid.",
  },
];

const MORE = [
  "Could you pull up the last few invoices for Acme?",
  "Can you get my tax statement ready for last financial year?",
  "Mark invoice #0035 as paid, please",
  "Who has fallen behind on payments?",
  "How much have I billed this year, and all time?",
  "Back up everything for me, just in case",
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
