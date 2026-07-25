import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAllowedEmail } from "@/lib/auth";

/** Constant-time-ish compare so the key can't be probed byte by byte. */
function keyMatches(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

function isHermesPdfRequest(request: NextRequest): boolean {
  const expected = process.env.HERMES_API_KEY;
  if (!expected) return false;
  if (!request.nextUrl.pathname.endsWith("/pdf")) return false;
  const provided = request.headers.get("x-api-key");
  return Boolean(provided && keyMatches(provided, expected));
}

/**
 * The gateway endpoints authenticate themselves with a per-agent key (see
 * src/lib/gateway/auth.ts), so they must skip the browser-session enforcement
 * and reach their route handler, which returns a proper 401 instead of a
 * redirect to /login.
 */
function isGatewayRequest(request: NextRequest): boolean {
  const path = request.nextUrl.pathname;
  return path.startsWith("/api/agent") || path.startsWith("/api/mcp");
}

/**
 * Runs on every request: refreshes the Supabase session cookie and enforces
 * access. Public paths are /login and /auth/*; everything else requires an
 * authenticated AND whitelisted user.
 */
export async function updateSession(request: NextRequest) {
  // Hermes/Ema has no browser session, so it authenticates the PDF endpoints
  // with a shared key instead. Inert until HERMES_API_KEY is set in the env,
  // and deliberately scoped to `/pdf` only — never to the rest of the app.
  if (isHermesPdfRequest(request) || isGatewayRequest(request)) {
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

  // Signed in but not on the whitelist → force sign out.
  if (user && !isAllowedEmail(user.email)) {
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
