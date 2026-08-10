import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Client, ClientWithIssuer } from "@/lib/types";

export async function listClients(orgId: string): Promise<ClientWithIssuer[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("clients")
    .select("*, issuer:issuers!clients_default_issuer_id_fkey(short_name, abn)")
    .eq("org_id", orgId)
    .order("name");
  if (error) throw new Error(`Failed to load clients: ${error.message}`);
  return (data ?? []) as unknown as ClientWithIssuer[];
}

export type ClientInput = {
  name: string;
  address_line: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  email: string | null;
  default_issuer_id: string | null;
  default_description: string | null;
  default_rate: number | null;
};

/**
 * The org is stamped here rather than taken from the input, so a caller cannot
 * file a client under somebody else's business. The trial quota is enforced by
 * a trigger in Postgres, which is what makes it apply to agents too.
 */
export async function createClient(
  orgId: string,
  input: ClientInput,
): Promise<Client> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("clients")
    .insert({ ...input, org_id: orgId })
    .select("*")
    .single();
  if (error) throw new Error(`Failed to create client: ${error.message}`);
  return data as Client;
}

export async function updateClient(
  orgId: string,
  id: string,
  input: Partial<ClientInput>,
): Promise<Client> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("clients")
    .update(input)
    .eq("org_id", orgId)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`Failed to update client: ${error.message}`);
  return data as Client;
}

export async function deleteClient(orgId: string, id: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("clients")
    .delete()
    .eq("org_id", orgId)
    .eq("id", id);
  if (error) throw new Error(`Failed to delete client: ${error.message}`);
}
