import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Issuer } from "@/lib/types";

export async function listIssuers(): Promise<Issuer[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("issuers")
    .select("*")
    .order("short_name");
  if (error) throw new Error(`Failed to load issuers: ${error.message}`);
  return data ?? [];
}
