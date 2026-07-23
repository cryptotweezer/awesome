import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client — used only for authentication (Google login).
 * Uses the publishable/anon key, which is safe to expose in the browser.
 * It never touches the `awesome` schema directly; billing data goes through
 * the server-only admin client.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
