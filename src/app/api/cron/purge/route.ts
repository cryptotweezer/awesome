import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Delete trial businesses a month after they were created, used or not.
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
 * The logo files of the deleted businesses go with them, since object storage
 * is not covered by database cascades.
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

  const days = Number(new URL(request.url).searchParams.get("days") ?? 30);
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc("purge_stale_demo_orgs", {
    p_days: Number.isFinite(days) ? days : 30,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const purged = (data ?? []) as {
    purged_org_id: string;
    purged_logo_path: string | null;
  }[];

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

  return NextResponse.json({ purged: purged.length, days });
}
