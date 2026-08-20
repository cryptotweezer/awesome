import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAllowedEmail, isGuestSignupEnabled } from "@/lib/auth";

// A shared-secret bypass used to live here: any path ending in /pdf carrying
// `x-api-key: HERMES_API_KEY` skipped the session check entirely. It was left
// inert when the gateway replaced Hermes, and it has now been removed outright.
// With registration open it would have been a way to fetch documents without a
// session and without an organisation, which is precisely what must not exist.

/**
 * Endpoints that carry their own credential, or none at all, and have no
 * browser session: the gateway authenticates with a per-agent key or an OAuth
 * token (src/lib/gateway/auth.ts), the cron endpoint with CRON_SECRET, and the
 * OAuth machine endpoints with the client's own credentials. They skip the
 * session check so they reach their handler and can answer properly, instead
 * of being redirected to a login page a machine cannot use.
 *
 * The discovery documents are deliberately public: a client reads them BEFORE
 * it has any credential, which is the whole point of discovery.
 *
 * Note /oauth/authorize is NOT here. It is the one part of the flow that a
 * human performs in a browser, and it must require a session.
 *
 * Everything else, including /api/chat, needs a signed-in user.
 */
/**
 * A redirect target we are willing to send a browser to. One leading slash,
 * never two: `//evil.com` looks relative and is not.
 */
function isLocalPath(value: string | null): value is string {
  return !!value && value.startsWith("/") && !value.startsWith("//");
}

function isSelfAuthenticated(request: NextRequest): boolean {
  const path = request.nextUrl.pathname;
  return (
    path.startsWith("/api/agent") ||
    path.startsWith("/api/mcp") ||
    path.startsWith("/api/cron") ||
    path.startsWith("/api/oauth") ||
    path.startsWith("/.well-known/")
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

  // Not signed in on a protected route → login. Consent carries its query
  // string through the login, because sending somebody to sign in and then
  // dropping them on the dashboard abandons the authorization half way and
  // the assistant waiting on the callback just times out.
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    const returnTo = path.startsWith("/oauth/authorize")
      ? `${path}${request.nextUrl.search}`
      : null;
    url.pathname = "/login";
    url.search = "";
    if (returnTo) url.searchParams.set("next", returnTo);
    return NextResponse.redirect(url);
  }

  // Already signed in and visiting /login → home, or on to whatever sent them
  // here. Somebody who is signed in and lands on the login page mid-consent
  // must continue the consent, not be dropped on the dashboard.
  if (user && path.startsWith("/login")) {
    const wanted = request.nextUrl.searchParams.get("next");
    const onward = isLocalPath(wanted) ? wanted : "/";
    return NextResponse.redirect(new URL(onward, request.nextUrl.origin));
  }

  return supabaseResponse;
}
