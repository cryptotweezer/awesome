import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Delete trial businesses that have gone quiet for 30 days.
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

  const purged = (data ?? []) as { purged_org_id: string }[];

  // Best effort: a leftover logo costs a few kilobytes, a failed purge costs a
  // database, so this never fails the request.
  for (const org of purged) {
    await supabase.storage
      .from("org-logos")
      .remove([`${org.purged_org_id}/logo.png`, `${org.purged_org_id}/logo.jpg`])
      .catch(() => undefined);
  }

  return NextResponse.json({ purged: purged.length, days });
}
