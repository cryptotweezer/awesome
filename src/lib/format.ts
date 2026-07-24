/**
 * Today in Sydney as "YYYY-MM-DD" — the only definition of "today" this app
 * uses. `toISOString()` is UTC, which runs up to 11 hours behind Sydney: on a
 * UTC server (Vercel) that shifts the financial year, overdue flags and the
 * default invoice date onto the wrong day. `en-CA` formats as YYYY-MM-DD.
 */
export function todayInSydney(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function formatAUD(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "—";
  return `AUD ${amount.toFixed(2)}`;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "2026-07-23" -> "23 Jul 2026" */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("T")[0].split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
