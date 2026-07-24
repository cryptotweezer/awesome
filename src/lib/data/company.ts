import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CompanyProfile } from "@/lib/types";

/** The single company_profile row (id = 1). Used by the printed documents. */
export async function getCompanyProfile(): Promise<CompanyProfile> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("company_profile")
    .select("*")
    .eq("id", 1)
    .single();
  if (error || !data) {
    throw new Error(`Failed to load company profile: ${error?.message}`);
  }
  return data as CompanyProfile;
}
