"use client";

import {
  createContext,
  useActionState,
  useContext,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import type { ClientWithIssuer } from "@/lib/types";
import { WEEKDAYS, aud, shortDate } from "@/lib/savings";
import {
  reorderRotationAction,
  setRotationAction,
  type ActionState,
} from "./actions";

const initial: ActionState = { ok: false };

const rate = (c: ClientWithIssuer) => c.default_rate ?? 0;
const inWeek = (c: ClientWithIssuer, n: 1 | 2) =>
  n === 1 ? c.in_week_1 : c.in_week_2;
const dayOf = (c: ClientWithIssuer, n: 1 | 2) =>
  n === 1 ? c.week_1_day : c.week_2_day;
const seqOf = (c: ClientWithIssuer, n: 1 | 2) =>
  n === 1 ? c.week_1_seq : c.week_2_seq;

/**
 * A day is worked in an order, so it is shown in that order: first placed,
 * first on the list. Alphabetical would be tidy and useless, because the list
 * is a route.
 *
 * A client placed before the order existed has no position and sorts last,
 * which is a better guess than pretending they are first.
 */
function inRouteOrder(rows: ClientWithIssuer[], n: 1 | 2) {
  return [...rows].sort((a, b) => {
    const x = seqOf(a, n);
    const y = seqOf(b, n);
    if (x === null && y === null) return a.name.localeCompare(b.name);
    if (x === null) return 1;
    if (y === null) return -1;
    return x - y;
  });
}

function cadenceLabel(c: ClientWithIssuer) {
  switch (c.cadence) {
    case "weekly":
      return "weekly";
    case "fortnightly":
      return "fortnightly";
    case "monthly":
      return "monthly";
    case "occasional":
      return "whenever they ask";
    case "every_n_weeks":
      return c.cadence_weeks ? `every ${c.cadence_weeks} weeks` : "every N weeks";
    default:
      return c.cadence;
  }
}

/**
 * The two-week rotation, a day at a time.
 *
 * The week is not worked as a lump sum, it is worked on Monday and then on
 * Tuesday, and when something moves it moves to another day. So the unit on
 * screen is the day: who is on it, what it brings in, and how to move somebody
 * off it.
 *
 * This is still the plan and not the record. It says who is due and what should
 * come in, and it repeats. What actually happened in a given calendar week,
 * including the days somebody cancelled, belongs to that week and is kept
 * there.
 */
export function RotationBoard({
  clients,
  expenses,
  cycles,
}: {
  clients: ClientWithIssuer[];
  /** The standing weekly costs. Loans are not part of this screen. */
  expenses: number;
  /** The clients on a longer cycle, with their next date worked out. */
  cycles: CycleRow[];
}) {
  const active = clients.filter((c) => c.is_active);
  const onCycle = new Set(cycles.map((c) => c.id));
  const unplaced = active.filter(
    (c) => !c.in_week_1 && !c.in_week_2 && !onCycle.has(c.id),
  );

  const [dragging, setDragging] = useState<Dragging>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const board: DragBoard = {
    dragging,
    start: setDragging,
    end: () => setDragging(null),
    pending,
    error,
    drop: (week, day, ids, moved) => {
      setDragging(null);
      if (!moved) return;
      // Dropped where it already was, in the same place: nothing happened.
      const form = new FormData();
      form.set("week", String(week));
      form.set("day", String(day));
      form.set("ids", ids.join(","));
      form.set("moved", moved.id);
      if (moved.week !== week) form.set("from", String(moved.week));
      setError(null);
      startTransition(async () => {
        const result = await reorderRotationAction({ ok: false }, form);
        if (result.error) setError(result.error);
      });
    },
  };

  return (
    <Board.Provider value={board}>
    <div className="space-y-6">
      {error && (
        <p className="rounded-2xl bg-red-50 px-5 py-3 text-sm text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900">
          {error}
        </p>
      )}
      {/* The order is written the moment the chip is dropped, so the only thing
          to say is that it is being written. */}
      {pending && (
        <p className="text-xs font-medium text-slate-400 dark:text-slate-500">
          Saving the order…
        </p>
      )}
      <Week n={1} clients={active} expenses={expenses} />
      <Week n={2} clients={active} expenses={expenses} />

      <LongerCycle rows={cycles} />

      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Not on the rotation
        </h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Nothing is expected from these in a normal week. They are recorded in
          whichever week the work actually happened.
        </p>
        {unplaced.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400 dark:text-slate-500">
            Everyone is placed.
          </p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {unplaced.map((c) => (
              <li
                key={c.id}
                className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400"
              >
                {c.name}
                <span className="ml-1.5 text-slate-400 dark:text-slate-500">
                  {cadenceLabel(c)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
    </Board.Provider>
  );
}

/**
 * Dragging a client from one day to another.
 *
 * Native drag and drop, no library: a day is a drop zone and a client is a
 * draggable, which is the whole of it. The select on every chip stays exactly as
 * it was, because dragging does not work on a phone and a board that can only be
 * arranged on a laptop would be a board Mavi cannot use.
 *
 * What the server is told is never "move this one up", it is the day's whole new
 * order, so two drags at once cannot leave two clients on the same position.
 */
type Dragging = { id: string; week: 1 | 2; day: number | null } | null;

type DragBoard = {
  dragging: Dragging;
  start: (d: Dragging) => void;
  end: () => void;
  /** Write a day's new order. `ids` is that day, in full, as it should read. */
  drop: (week: 1 | 2, day: number, ids: string[], moved: Dragging) => void;
  pending: boolean;
  error: string | null;
};

const Board = createContext<DragBoard | null>(null);

function useBoard(): DragBoard {
  const ctx = useContext(Board);
  if (!ctx) throw new Error("A rotation chip outside the board");
  return ctx;
}

/**
 * The day's new order: `moved` goes in front of `before`, or last for null.
 *
 * By the id it was dropped on and never by an index. An index is read from the
 * list as it looks NOW, and the moment the dragged client is taken out of it
 * every index below them shifts by one, so dropping something onto its
 * neighbour below moved it nowhere.
 */
function insertBefore(
  ids: string[],
  movedId: string,
  beforeId: string | null,
): string[] {
  // Dropped on itself: nothing was asked for.
  if (beforeId === movedId) return ids;
  const without = ids.filter((i) => i !== movedId);
  if (beforeId === null) return [...without, movedId];
  const at = without.indexOf(beforeId);
  if (at === -1) return [...without, movedId];
  return [...without.slice(0, at), movedId, ...without.slice(at)];
}

/**
 * What is being dragged, read from the drag itself.
 *
 * The board also keeps it in state for the highlight, but a drop must not
 * depend on that: a state update and a native drag are two different clocks,
 * and a drop that arrives first would be ignored. The drag carries its own
 * answer.
 */
function draggedFrom(
  e: React.DragEvent,
  fallback: Dragging,
): Dragging {
  try {
    const raw = e.dataTransfer.getData("text/plain");
    if (raw) {
      const parsed = JSON.parse(raw) as Dragging;
      if (parsed && parsed.id) return parsed;
    }
  } catch {
    // Not ours, or the browser would not hand it over. The state still knows.
  }
  return fallback;
}

export type CycleRow = {
  id: string;
  name: string;
  cadence: ClientWithIssuer["cadence"];
  cadence_weeks: number | null;
  rate: number;
  /** The last day their work was really done, or null if it never was. */
  last_service_on: string | null;
  /** Counted from that day. Null until there is a first service to count from. */
  next_due_on: string | null;
  overdue: boolean;
  /**
   * The week of the plan that date falls in: which week to actually do them in,
   * and where the money is expected. Null when there is no date yet, or when it
   * falls outside the plan that is running.
   */
  week_start: string | null;
  week_end: string | null;
  /** 1 or 2, the side of the rotation that week is. */
  rotation_week: number | null;
  /** The week's id, once it has been opened. Future weeks do not exist yet. */
  week_id: string | null;
  /** Whether that week already carries a line for them. */
  scheduled: boolean;
};

/**
 * The clients the two-week rotation cannot hold.
 *
 * A month is not a whole number of fortnights and "every three weeks" lands in
 * a different one of the two every time, so these are not in week 1 or week 2
 * at all. Their date is counted forward from the last service that actually
 * happened, and the week it falls in picks them up by itself.
 *
 * Which is the point of this list: before it, a monthly client existed nowhere
 * between visits, and the only thing keeping them on the round was somebody
 * remembering.
 */
function LongerCycle({ rows }: { rows: CycleRow[] }) {
  if (rows.length === 0) return null;

  const total = rows.reduce((sum, r) => sum + r.rate, 0);

  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Monthly and longer
          </h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Counted from their last service, then placed in the week their date
            falls in. Do one on another day and the next one counts from there.
          </p>
        </div>
        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {aud(total)} a round
        </span>
      </header>

      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3"
          >
            <span className="min-w-[10rem] flex-1 font-medium text-slate-900 dark:text-slate-100">
              {r.name}
              <span className="ml-2 text-[11px] font-normal text-slate-400 dark:text-slate-500">
                {r.cadence === "monthly"
                  ? "monthly"
                  : r.cadence_weeks
                    ? `every ${r.cadence_weeks} weeks`
                    : "every N weeks"}
              </span>
            </span>

            <span className="text-xs text-slate-500 dark:text-slate-400">
              {r.last_service_on
                ? `last ${shortDate(r.last_service_on)}`
                : "never done"}
            </span>

            <span className="w-32 text-xs">
              {r.next_due_on === null ? (
                <span className="text-amber-600 dark:text-amber-400">
                  waiting on a first service
                </span>
              ) : r.overdue ? (
                <span className="font-medium text-amber-600 dark:text-amber-400">
                  due {shortDate(r.next_due_on)}, overdue
                </span>
              ) : (
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  due {shortDate(r.next_due_on)}
                </span>
              )}
            </span>

            {/* Which week to do them in, which is the question this list exists
                to answer. A week that has been opened is a link; one still in
                the future is a date, because it does not exist yet. */}
            <span className="w-44 text-xs">
              {r.week_start === null ? (
                <span className="text-slate-400 dark:text-slate-500">–</span>
              ) : (
                <>
                  {r.week_id ? (
                    <Link
                      href={`/savings/weeks/${r.week_id}`}
                      className="font-medium text-slate-700 underline-offset-2 hover:underline dark:text-slate-300"
                    >
                      Week {r.rotation_week}
                    </Link>
                  ) : (
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      Week {r.rotation_week}
                    </span>
                  )}
                  <span className="text-slate-400 dark:text-slate-500">
                    {" "}
                    {shortDate(r.week_start)}
                    {r.week_end ? ` to ${shortDate(r.week_end)}` : ""}
                  </span>
                  {r.scheduled && (
                    <span className="ml-1 text-emerald-600 dark:text-emerald-400">
                      · on it
                    </span>
                  )}
                </>
              )}
            </span>

            <span className="w-20 text-right text-sm text-slate-600 dark:text-slate-400">
              {aud(r.rate)}
            </span>
          </li>
        ))}
      </ul>

      <p className="border-t border-slate-100 px-5 py-3 text-[11px] text-slate-400 dark:border-slate-800 dark:text-slate-500">
        A date that has gone by without the work being done stays here as
        overdue rather than being pasted into every later week, which would count
        the money twice. Add the service to the week it happened in and the next
        date counts from there. &quot;On it&quot; means that week already has a
        line for them, with their money expected in it.
      </p>
    </section>
  );
}

/**
 * One side of the rotation, day by day.
 *
 * Clients can be dragged between the days and between the two weeks. Dropping
 * on a client puts them in front of it, dropping on the day puts them last, and
 * the order is the order of the round. Dragging into the other week MOVES them,
 * unless they are in both weeks already, in which case they belong to both and
 * only that week's day changes.
 */
function Week({
  n,
  clients,
  expenses,
}: {
  n: 1 | 2;
  clients: ClientWithIssuer[];
  expenses: number;
}) {
  const mine = clients.filter((c) => inWeek(c, n));
  const available = clients.filter((c) => !inWeek(c, n));
  const undecided = mine.filter((c) => dayOf(c, n) === null);

  // Grouped the way the money arrives, so the two figures add up to the week
  // and a client who is never invoiced is not counted as one who is.
  const cash = mine
    .filter((c) => c.billing_type === "cash")
    .reduce((sum, c) => sum + rate(c), 0);
  const account = mine
    .filter((c) => c.billing_type !== "cash")
    .reduce((sum, c) => sum + rate(c), 0);

  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Week {n}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {mine.length} {mine.length === 1 ? "client" : "clients"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-5">
          <Figure label="Cash" value={aud(cash)} />
          <Figure label="Account" value={aud(account)} />
          <Figure label="Week total" value={aud(cash + account)} />
          <Figure label="Expenses" value={aud(expenses)} tone="out" />
          {/* What comes in, less the standing weekly costs. Loans are not part
              of this screen at all: this tab answers what a normal week takes
              in and what it costs, and nothing else. */}
          <Figure
            label="Left over"
            value={aud(cash + account - expenses)}
            strong
            tone={cash + account - expenses < 0 ? "bad" : "in"}
          />
        </div>
      </header>

      <div className="grid gap-px bg-slate-200 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 dark:bg-slate-800">
        {WEEKDAYS.map((d) => (
          <Day
            key={d.value}
            week={n}
            day={d.value}
            label={d.short}
            clients={inRouteOrder(
              mine.filter((c) => dayOf(c, n) === d.value),
              n,
            )}
            available={available}
          />
        ))}
      </div>

      {undecided.length > 0 && (
        <div className="border-t border-slate-200 bg-amber-50 px-5 py-3 dark:border-slate-800 dark:bg-amber-950/30">
          <p className="text-xs font-medium text-amber-900 dark:text-amber-200">
            In week {n}, no day yet
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {inRouteOrder(undecided, n).map((c) => (
              <li key={c.id}>
                <ClientChip client={c} week={n} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Day({
  week,
  day,
  label,
  clients,
  available,
}: {
  week: 1 | 2;
  day: number;
  label: string;
  clients: ClientWithIssuer[];
  available: ClientWithIssuer[];
}) {
  const [adding, setAdding] = useState(false);
  const total = clients.reduce((sum, c) => sum + rate(c), 0);
  const board = useBoard();
  const [over, setOver] = useState(false);

  const ids = clients.map((c) => c.id);
  const dragging = board.dragging;
  const [beforeId, setBeforeId] = useState<string | null>(null);

  // The whole day is a drop zone: dropping on the day itself puts the client
  // last, dropping on a client puts them in front of that one.
  const dropHere = (e: React.DragEvent, before: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    setBeforeId(null);
    const moved = draggedFrom(e, dragging);
    if (!moved) return;
    const order = insertBefore(ids, moved.id, before);
    // Nothing changed and it did not come from another day: no write.
    if (moved.week === week && moved.day === day && order.join() === ids.join()) {
      return;
    }
    board.drop(week, day, order, moved);
  };

  return (
    <div
      // Always accepted, never conditional on what React knows yet: a drop zone
      // that forgets to preventDefault on dragover simply refuses the drop.
      onDragOver={(e) => {
        e.preventDefault();
        // Without this some browsers draw the "no drop" cursor and then refuse
        // the drop entirely.
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={(e) => {
        // Moving onto a child fires a leave on the parent; ignore it.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setOver(false);
        setBeforeId(null);
      }}
      onDrop={(e) => dropHere(e, null)}
      className={`min-h-[9rem] p-3 transition ${
        over
          ? "bg-sky-50 dark:bg-sky-950/40"
          : "bg-white dark:bg-slate-900"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {label}
        </span>
        {total > 0 && (
          <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            {aud(total)}
          </span>
        )}
      </div>

      <ul className="mt-2 space-y-1.5">
        {clients.map((c) => (
          <li
            key={c.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              // The drag carries where it came from, so a drop never has to wait
              // for React to have caught up. Something must be set here or
              // Firefox refuses to start the drag at all.
              const from: Dragging = { id: c.id, week, day };
              e.dataTransfer.setData("text/plain", JSON.stringify(from));
              board.start(from);
            }}
            onDragEnd={() => {
              board.end();
              setBeforeId(null);
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOver(false);
              setBeforeId(c.id);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = "move";
              setOver(false);
              setBeforeId(c.id);
            }}
            onDrop={(e) => dropHere(e, c.id)}
            className={`cursor-grab rounded-lg active:cursor-grabbing ${
              dragging?.id === c.id ? "opacity-40" : ""
            } ${
              beforeId === c.id && dragging?.id !== c.id
                ? "ring-2 ring-sky-400 dark:ring-sky-500"
                : ""
            }`}
          >
            <ClientChip client={c} week={week} />
          </li>
        ))}
      </ul>

      {adding ? (
        <div className="mt-2 space-y-1">
          {available.length === 0 ? (
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              Everyone is already in this week.{" "}
              <Link href="/savings/clients" className="underline">
                Add a client
              </Link>
            </p>
          ) : (
            available.map((c) => (
              <PlaceButton
                key={c.id}
                clientId={c.id}
                week={week}
                day={String(day)}
                label={c.name}
              />
            ))
          )}
          <button
            onClick={() => setAdding(false)}
            className="mt-1 text-[11px] font-medium text-slate-400 hover:underline dark:text-slate-500"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="mt-2 w-full rounded-lg border border-dashed border-slate-300 py-1.5 text-[11px] font-medium text-slate-400 transition hover:border-slate-400 hover:text-slate-600 dark:border-slate-700 dark:text-slate-500 dark:hover:border-slate-600 dark:hover:text-slate-300"
        >
          + Add
        </button>
      )}
    </div>
  );
}

/**
 * A client on a day. The select is the whole interaction: pick another day to
 * move them, or Remove to take them out of the week. One control, no drag and
 * drop to discover, and it works on a phone.
 */
function ClientChip({
  client,
  week,
}: {
  client: ClientWithIssuer;
  week: 1 | 2;
}) {
  const [state, action, pending] = useActionState(setRotationAction, initial);
  const formRef = useRef<HTMLFormElement>(null);
  // One colour per kind, so a board can be read without opening anything:
  // green is money in hand, blue is an invoice, violet is a transfer with no
  // invoice behind it.
  const tone =
    client.billing_type === "cash"
      ? "bg-emerald-50 ring-emerald-200 dark:bg-emerald-950/40 dark:ring-emerald-900"
      : client.billing_type === "transfer"
        ? "bg-violet-50 ring-violet-200 dark:bg-violet-950/40 dark:ring-violet-900"
        : "bg-sky-50 ring-sky-200 dark:bg-sky-950/40 dark:ring-sky-900";

  return (
    <form
      ref={formRef}
      action={action}
      className={`rounded-lg px-2 py-1.5 ring-1 ${tone} ${
        pending ? "opacity-50" : ""
      }`}
    >
      <input type="hidden" name="client_id" value={client.id} />
      <input type="hidden" name="week" value={week} />

      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-slate-900 dark:text-slate-100">
          {/* The grip is the only hint that a chip can be dragged. Everything
              still works without it: the select below moves them too. */}
          <span
            aria-hidden="true"
            className="mr-1 select-none text-slate-400 dark:text-slate-500"
          >
            ⠿
          </span>
          {client.name}
        </span>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          {client.default_rate === null ? "–" : aud(client.default_rate)}
        </span>
      </div>

      <select
        name="day"
        defaultValue={String(dayOf(client, week) ?? "")}
        onChange={() => formRef.current?.requestSubmit()}
        disabled={pending}
        className="mt-1 w-full cursor-pointer rounded border-0 bg-transparent p-0 text-[11px] text-slate-500 focus:ring-0 dark:text-slate-400"
      >
        {WEEKDAYS.map((d) => (
          <option key={d.value} value={d.value}>
            {d.label}
          </option>
        ))}
        <option value="">No day yet</option>
        <option value="remove">Remove from week {week}</option>
      </select>

      {state.error && (
        <p className="text-[11px] text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
    </form>
  );
}

function PlaceButton({
  clientId,
  week,
  day,
  label,
}: {
  clientId: string;
  week: 1 | 2;
  day: string;
  label: string;
}) {
  const [state, action, pending] = useActionState(setRotationAction, initial);

  return (
    <form action={action}>
      <input type="hidden" name="client_id" value={clientId} />
      <input type="hidden" name="week" value={week} />
      <input type="hidden" name="day" value={day} />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-left text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        {pending ? "…" : label}
      </button>
      {state.error && (
        <p className="text-[11px] text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
    </form>
  );
}

/**
 * Money going out is muted red and money staying is green, so the shape of a
 * week reads before any of the numbers do. `bad` is the loud red, saved for the
 * one case that deserves it: a week that does not cover itself.
 */
const TONES = {
  plain: "text-slate-900 dark:text-slate-100",
  out: "text-rose-400 dark:text-rose-400/90",
  in: "text-emerald-600 dark:text-emerald-400",
  bad: "text-red-600 dark:text-red-400",
} as const;

function Figure({
  label,
  value,
  strong = false,
  tone = "plain",
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: keyof typeof TONES;
}) {
  return (
    <div className="text-right">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className={`font-bold ${strong ? "text-xl" : "text-base"} ${TONES[tone]}`}>
        {value}
      </p>
    </div>
  );
}
