import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail, isGuestSignupEnabled } from "@/lib/auth";
import { getCurrentOrg, touchOrgActivity } from "@/lib/data/org";
import { protectAuth } from "@/lib/security/arcjet";

/**
 * Google OAuth callback. Exchanges the code for a session, then decides where
 * the person lands: into the dashboard either way, since the dashboard now
 * greets a business-less account with the tour, or straight back out if guest
 * signup is closed and they are not staff.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  // The one door open to the whole internet once signups are enabled. Shield
  // and a per-address ceiling only: no bot detection, because a false positive
  // here means a real person cannot sign in at all.
  const guard = await protectAuth(request);
  if (!guard.ok) {
    return NextResponse.redirect(`${origin}/login?error=blocked`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isAllowedEmail(user?.email) && !isGuestSignupEnabled()) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=unauthorized`);
  }

  // Respect proxy host in production (e.g. Vercel) for the final redirect.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const isLocalEnv = process.env.NODE_ENV === "development";
  const base =
    !isLocalEnv && forwardedHost ? `https://${forwardedHost}` : origin;

  // Last seen, kept for the record rather than for the purge: a trial now ends
  // thirty days after it starts whether or not anybody signed in.
  const ctx = await getCurrentOrg();
  if (ctx) await touchOrgActivity(ctx.org.id);

  return NextResponse.redirect(`${base}${next}`);
}
