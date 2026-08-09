import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail, isGuestSignupEnabled } from "@/lib/auth";
import { getCurrentOrg, touchOrgActivity } from "@/lib/data/org";

/**
 * Google OAuth callback. Exchanges the code for a session, then decides where
 * the person lands: into the dashboard if they already belong to a business,
 * into onboarding if they do not, or straight back out if guest signup is
 * closed and they are not staff.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

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

  // Signing in is the clearest sign a trial business is still in use, and it is
  // what keeps it from being purged after 30 quiet days.
  const ctx = await getCurrentOrg();
  if (!ctx) return NextResponse.redirect(`${base}/onboarding`);
  await touchOrgActivity(ctx.org.id);

  return NextResponse.redirect(`${base}${next}`);
}
