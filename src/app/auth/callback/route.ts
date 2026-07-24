import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/auth";

/**
 * Google OAuth callback. Exchanges the code for a session, then enforces the
 * email whitelist: a non-whitelisted user is signed out immediately so no
 * usable session ever persists.
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

  if (!isAllowedEmail(user?.email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=unauthorized`);
  }

  // Respect proxy host in production (e.g. Vercel) for the final redirect.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const isLocalEnv = process.env.NODE_ENV === "development";
  const base =
    !isLocalEnv && forwardedHost ? `https://${forwardedHost}` : origin;

  return NextResponse.redirect(`${base}${next}`);
}
