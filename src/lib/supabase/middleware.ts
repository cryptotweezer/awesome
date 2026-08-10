import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAllowedEmail, isGuestSignupEnabled } from "@/lib/auth";

// A shared-secret bypass used to live here: any path ending in /pdf carrying
// `x-api-key: HERMES_API_KEY` skipped the session check entirely. It was left
// inert when the gateway replaced Hermes, and it has now been removed outright.
// With registration open it would have been a way to fetch documents without a
// session and without an organisation, which is precisely what must not exist.

/**
 * Endpoints that carry their own credential and have no browser session:
 * the gateway authenticates with a per-agent key (src/lib/gateway/auth.ts) and
 * the cron endpoint with CRON_SECRET. They skip the session check so they reach
 * their handler and can answer 401 properly, instead of being redirected to a
 * login page a machine cannot use.
 *
 * Everything else, including /api/chat, needs a signed-in user.
 */
function isSelfAuthenticated(request: NextRequest): boolean {
  const path = request.nextUrl.pathname;
  return (
    path.startsWith("/api/agent") ||
    path.startsWith("/api/mcp") ||
    path.startsWith("/api/cron")
  );
}

/**
 * Runs on every request: refreshes the Supabase session cookie and decides who
 * gets past the door. Public paths are /login and /auth/*; everything else
 * needs a signed-in user.
 *
 * What it deliberately does NOT do is look up the user's organisation. That
 * would be a database round trip on every single request, so it happens once
 * per page in the app layout instead, which shows the tour when the user has
 * no business yet.
 */
export async function updateSession(request: NextRequest) {
  if (isSelfAuthenticated(request)) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = path.startsWith("/login") || path.startsWith("/auth");

  // Signed in, not on the staff list, and guest signup is closed → force sign
  // out. Flipping GUEST_SIGNUP to "true" is what opens the door to strangers,
  // and it is an env var precisely so opening it needs no deploy.
  if (user && !isAllowedEmail(user.email) && !isGuestSignupEnabled()) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/signout";
    url.searchParams.set("error", "unauthorized");
    return NextResponse.redirect(url);
  }

  // Not signed in on a protected route → login.
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Already signed in and visiting /login → home.
  if (user && path.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
