import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayInSydney } from "@/lib/format";

/**
 * Delete every trial business on the 1st of the month, and trim the agent
 * tables daily.
 *
 *   GET /api/cron/purge
 *   Authorization: Bearer $CRON_SECRET
 *
 * Scheduled daily by Vercel Cron (see vercel.json), which sends exactly that
 * header when CRON_SECRET is set on the project. Any machine with curl can call
 * it the same way.
 *
 * Deleting data is not something a stray request should be able to trigger, so
 * with no CRON_SECRET this endpoint refuses to run at all rather than running
 * unprotected: until that variable is set, the schedule fires and nothing is
 * deleted, which is the safe way round.
 *
 * Why a date and not an age: trials used to end a month after each sign-up,
 * which meant up to a month of strangers' data in the database at any moment,
 * on thirty different expiry dates. One date for everybody is smaller to hold
 * and takes one sentence to explain. Awesome is not a trial (is_demo = false)
 * and no argument here can reach it.
 *
 * The schedule stays daily because the second job below wants it, and because
 * a monthly cron that fails has to wait a month for its next chance. Whether
 * today is the 1st is decided in Sydney, not UTC: the cron fires at 15:00 UTC,
 * which is already the next day there.
 *
 * The logo files of the deleted businesses go with them, since object storage
 * is not covered by database cascades.
 *
 * Overrides, for running it by hand: `?days=30` purges trials older than that
 * many days instead of sweeping, and `?sweep=1` sweeps on a day that is not
 * the 1st.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Purging is not configured on this deployment." },
      { status: 503 },
    );
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const supabase = createAdminClient();

  // 0 means "every trial, whatever its age", which is what the sweep is.
  const asked = Number(params.get("days"));
  const explicitDays = Number.isFinite(asked) && params.has("days") ? asked : null;
  const isFirstOfMonth = todayInSydney().endsWith("-01");
  const sweeping = explicitDays === null && (isFirstOfMonth || params.has("sweep"));
  const days = explicitDays ?? (sweeping ? 0 : null);

  const purged: { purged_org_id: string; purged_logo_path: string | null }[] = [];
  if (days !== null) {
    const { data, error } = await supabase.rpc("purge_stale_demo_orgs", {
      p_days: days,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    purged.push(...((data ?? []) as typeof purged));
  }

  // Best effort: a leftover logo costs a few kilobytes, a failed purge costs a
  // database, so this never fails the request. The path comes back with the
  // deleted row, since by now there is nothing left to look it up in.
  const logos = purged
    .map((org) => org.purged_logo_path)
    .filter((path): path is string => !!path);
  if (logos.length > 0) {
    await supabase.storage
      .from("org-logos")
      .remove(logos)
      .catch(() => undefined);
  }

  // Every day, sweep or not: the agent log and the retry guard are append-only,
  // so without an expiry they become the biggest tables in the database and
  // nobody notices until it matters. This is not gated on the purge succeeding,
  // and a failure here is reported, not fatal.
  const { data: history, error: historyError } = await supabase.rpc(
    "purge_agent_history",
    { p_call_days: 90, p_write_days: 1 },
  );
  const trimmed = (history ?? [])[0] as
    | { purged_calls: number; purged_writes: number }
    | undefined;

  return NextResponse.json({
    swept: sweeping,
    purged: purged.length,
    ...(days === null ? {} : { days }),
    agent_calls_removed: trimmed?.purged_calls ?? 0,
    agent_writes_removed: trimmed?.purged_writes ?? 0,
    ...(historyError ? { agent_history_error: historyError.message } : {}),
  });
}
