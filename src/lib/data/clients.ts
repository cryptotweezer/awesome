import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Client, ClientWithIssuer } from "@/lib/types";

export async function listClients(): Promise<ClientWithIssuer[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("clients")
    .select("*, issuer:issuers!clients_default_issuer_id_fkey(short_name, abn)")
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
  default_description: string;
  default_rate: number | null;
};

export async function createClient(input: ClientInput): Promise<Client> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("clients")
    .insert(input)
    .select("*")
    .single();
  if (error) throw new Error(`Failed to create client: ${error.message}`);
  return data as Client;
}

export async function updateClient(
  id: string,
  input: Partial<ClientInput>,
): Promise<Client> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("clients")
    .update(input)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`Failed to update client: ${error.message}`);
  return data as Client;
}

export async function deleteClient(id: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("clients").delete().eq("id", id);
  if (error) throw new Error(`Failed to delete client: ${error.message}`);
}
