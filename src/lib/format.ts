/**
 * Today in one business's own time zone, as "YYYY-MM-DD". This is the only
 * definition of "today" the app uses.
 *
 * Never `toISOString()`: that is UTC, which runs up to 11 hours behind Sydney,
 * so on a UTC server (Vercel) it shifts the financial year, the overdue flags
 * and the default invoice date onto the wrong day. `en-CA` formats as
 * YYYY-MM-DD.
 *
 * An unknown zone would make Intl throw, which would take a page down over a
 * settings typo, so it falls back rather than failing.
 */
export function todayInTimezone(
  timezone: string,
  now: Date = new Date(),
): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return todayInSydney(now);
  }
}

/**
 * The original business runs on Sydney time. Kept for the few places with no
 * organisation in hand, and as the fallback above.
 */
export function todayInSydney(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * When the next monthly sweep of trial accounts runs: the 1st of the coming
 * month, decided in Sydney, which is where the cron decides what day it is.
 *
 * Today always counts as a day left, so the banner reads "1 day" on the last
 * day and never "0 days": a trial is deleted at the start of the 1st, and
 * telling somebody they have no time left while they still have hours of it is
 * how a person skips the export they meant to do.
 */
export function nextTrialPurge(today: string = todayInSydney()): {
  date: string;
  daysLeft: number;
} {
  const [year, month, day] = today.split("-").map(Number);
  const firstOfNext = Date.UTC(year, month, 1); // month is 1-based, so this is next
  const now = Date.UTC(year, month - 1, day);
  return {
    date: new Date(firstOfNext).toISOString().slice(0, 10),
    daysLeft: Math.round((firstOfNext - now) / 86_400_000),
  };
}

export function formatAUD(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "-";
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
  if (!iso) return "-";
  const [y, m, d] = iso.split("T")[0].split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/**
 * Whole days between a timestamp and now, floored at zero.
 *
 * Used for "this trial ends in N days". Deliberately not timezone-aware: it
 * counts elapsed time, not calendar days, which is exactly what the purge does.
 */
export function daysSince(iso: string): number {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}
