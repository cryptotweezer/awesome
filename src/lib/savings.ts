import type {
  BillingType,
  Client,
  DeductionCategory,
  ExpenseCategory,
  ExpenseItem,
  PaymentMethod,
} from "@/lib/types";

/**
 * Shared vocabulary for the savings dashboard.
 *
 * Neither "server-only" nor "use client": both sides need these, and a value
 * exported from a client module and imported by a server page is a client
 * reference, not the array it looks like.
 */

/** The three commitments a weekly cost belongs to, in the order they are shown. */
export const EXPENSE_CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: "australia", label: "Australia" },
  { value: "colombia", label: "Colombia" },
  { value: "visa", label: "Visa" },
];

/**
 * The kinds of tax deduction, in the order they are offered.
 *
 * Shared between the form, the list, the PDF and the agent's tool, so the words
 * a person picks are the words the accountant reads.
 */
export const DEDUCTION_CATEGORIES: {
  value: DeductionCategory;
  label: string;
}[] = [
  { value: "vehicle", label: "Vehicle" },
  { value: "tools", label: "Tools" },
  { value: "equipment", label: "Equipment" },
  { value: "supplies", label: "Supplies" },
  { value: "rags_washing", label: "Rags washing" },
  { value: "phone_internet", label: "Phone and internet" },
  { value: "insurance", label: "Insurance" },
  { value: "clothing", label: "Clothing" },
  { value: "other", label: "Other" },
];

export function deductionLabel(value: DeductionCategory | string): string {
  return DEDUCTION_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

export function categoryLabel(value: ExpenseCategory): string {
  return EXPENSE_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

/**
 * Whether a standing cost applies to a week, given the day that week ends.
 *
 * A cost with no start date has always been there: every week pays it. One with
 * a date is paid from the week that date falls in onwards, which is why the
 * comparison is against the week's LAST day: a cost that started on the
 * Wednesday belongs to that week, not to the next one.
 *
 * It lives here, in the shared vocabulary, because the week's figures, the
 * week's panel and the snapshot written at close all have to agree, and three
 * copies of one comparison is how they stop agreeing.
 */
export function appliesToWeek(
  item: Pick<ExpenseItem, "is_active" | "starts_on">,
  weekEnd: string,
): boolean {
  if (!item.is_active) return false;
  return !item.starts_on || item.starts_on <= weekEnd;
}

/**
 * The days of a rotation week, as ISO weekdays: 1 is Monday.
 *
 * No Sunday: Awesome does not work them. The database still accepts 7, so this
 * is a decision about the week rather than a constraint, and a Sunday job would
 * be one line here rather than a migration.
 */
export const WEEKDAYS: { value: number; label: string; short: string }[] = [
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
];

export function weekdayLabel(value: number | null): string {
  if (value === null) return "No day yet";
  return WEEKDAYS.find((d) => d.value === value)?.label ?? String(value);
}

/**
 * The same day of the month, `months` later, without overflowing.
 *
 * 31 January plus a month is the 28th, not the 3rd of March: a service on the
 * last day of a month belongs at the end of the next one.
 */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const firstOfTarget = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth() + 1, 0),
  ).getUTCDate();
  firstOfTarget.setUTCDate(Math.min(d, lastDay));
  return firstOfTarget.toISOString().slice(0, 10);
}

/**
 * When a client on a longer cycle is next due, counting from their last
 * service.
 *
 * The two-week rotation cannot hold these: a month is not a whole number of
 * fortnights, and "every three weeks" lands in a different one of the two every
 * time. So they are not placed in week 1 or week 2 at all; their next date is
 * counted from the last time the work was actually done, which is also what
 * makes a cancelled visit push the whole chain along rather than silently
 * skipping a turn.
 *
 * Null for anybody the plan cannot predict: weekly and fortnightly are the
 * rotation's own, and occasional means whenever they ask.
 */
export function nextDueOn(
  client: Pick<Client, "cadence" | "cadence_weeks">,
  lastServiceOn: string,
): string | null {
  if (client.cadence === "monthly") return addMonths(lastServiceOn, 1);
  if (client.cadence === "every_n_weeks" && client.cadence_weeks) {
    const [y, m, d] = lastServiceOn.split("-").map(Number);
    const at = Date.UTC(y, m - 1, d) + client.cadence_weeks * 7 * 86_400_000;
    return new Date(at).toISOString().slice(0, 10);
  }
  return null;
}

/** Clients the rotation cannot hold, which are scheduled from their last visit. */
export function isLongerCycle(
  client: Pick<Client, "cadence">,
): boolean {
  return client.cadence === "monthly" || client.cadence === "every_n_weeks";
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

/**
 * A date as `21 Sep`, read off the string without building a Date.
 *
 * `new Date("2026-09-21")` is midnight UTC, which in Sydney is already the
 * 21st but in Bogota is still the 20th, so formatting one in the browser moves
 * the day for half the world. The string already says what the day is.
 */
export function shortDate(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
}

/**
 * How a client's line starts out, from what kind of client they are.
 *
 * The line can be changed afterwards: what this decides is only what the week
 * expects before anybody corrects it.
 */
export function methodFor(billingType: BillingType): PaymentMethod {
  if (billingType === "invoice") return "account";
  if (billingType === "transfer") return "transfer";
  return "cash";
}

/**
 * The calendar date of a weekday inside one week of the plan.
 *
 * A plan week does not start on a Monday, it starts on whichever weekday the
 * plan began, so the date cannot be worked out from the day number alone. This
 * walks the week's own seven days and returns the one that falls on `day`.
 *
 * It is what makes the two halves of the app agree: an invoice raised from a
 * week line carries THIS as its service date, which is the same key `syncWeek`
 * reads back to put the invoice on the week.
 */
export function serviceDateFor(weekStart: string, day: number | null): string {
  if (day === null) return weekStart;
  const [y, m, d] = weekStart.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);
  for (let i = 0; i < 7; i++) {
    const at = new Date(base + i * 86_400_000);
    const iso = at.getUTCDay() === 0 ? 7 : at.getUTCDay();
    if (iso === day) return at.toISOString().slice(0, 10);
  }
  return weekStart;
}

/**
 * Money, the way Andres reads it: `AUD 2.000`, not `AUD 2000.00`.
 *
 * Dots group the thousands and a comma marks the cents, which is the Colombian
 * convention and the one he counts in. Cents only appear when there are any: a
 * column of `.00` is noise on a page whose amounts are nearly all round.
 *
 * Deliberately only in the savings dashboard. The invoices, the statements and
 * every PDF keep the Australian format, because those are read by Australian
 * clients, to whom `2.000` means two.
 */
const WITH_CENTS = new Intl.NumberFormat("es-CO", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const WHOLE = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

export function aud(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  const format = Number.isInteger(rounded) ? WHOLE : WITH_CENTS;
  return `AUD ${format.format(rounded)}`;
}

/**
 * Colombian pesos, whole, with the thousands separated.
 *
 * Only ever shown beside the AUD figure it came from, never totalled with one:
 * a vault balance is one currency or it is nothing.
 */
export function cop(amount: number): string {
  return `COP ${WHOLE.format(Math.round(amount))}`;
}
