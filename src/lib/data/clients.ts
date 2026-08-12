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

/**
 * Delete a client, but never one that has been invoiced.
 *
 * The foreign key already refuses it; what it says back is a constraint name,
 * which tells the person nothing. So the invoices are counted first and the
 * refusal is written in the words of the business: how many there are and what
 * to do instead. Invoices are the record of what was billed, and dragging them
 * out with the client would rewrite history no one is allowed to rewrite.
 */
export async function deleteClient(orgId: string, id: string): Promise<void> {
  const supabase = createAdminClient();

  const { count, error: countError } = await supabase
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("client_id", id);
  if (countError) {
    throw new Error(`Failed to check the client's invoices: ${countError.message}`);
  }
  if (count && count > 0) {
    throw new Error(
      `This client has ${count} ${count === 1 ? "invoice" : "invoices"} and cannot be deleted: they are your record of what you billed. Delete those invoices first if they were a mistake, or leave the client here.`,
    );
  }

  const { error } = await supabase
    .from("clients")
    .delete()
    .eq("org_id", orgId)
    .eq("id", id);
  if (error) throw new Error(`Failed to delete client: ${error.message}`);
}
