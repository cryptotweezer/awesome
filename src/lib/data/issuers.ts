import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Issuer } from "@/lib/types";

/**
 * The ABN (or TFN) holders that appear on an organisation's invoices. Awesome
 * has two, Mavi and Andres. A business that signs up gets exactly one, created
 * from its onboarding details, and never sees a picker.
 */
export async function listIssuers(orgId: string): Promise<Issuer[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("issuers")
    .select("*")
    .eq("org_id", orgId)
    .order("short_name");
  if (error) throw new Error(`Failed to load issuers: ${error.message}`);
  return data ?? [];
}

export async function getIssuer(
  orgId: string,
  id: string,
): Promise<Issuer | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("issuers")
    .select("*")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load issuer: ${error.message}`);
  return (data as Issuer) ?? null;
}
