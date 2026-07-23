import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client bound to the `awesome` schema, using the
 * service_role key. It bypasses RLS (the `awesome` tables have RLS enabled with
 * no policies), so it must NEVER be imported into client components.
 *
 * All billing reads/writes (clients, invoices, invoice_items, …) go through this.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.",
    );
  }

  return createClient(url, serviceRoleKey, {
    db: { schema: "awesome" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
