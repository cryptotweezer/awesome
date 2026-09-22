import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  BillingType,
  Cadence,
  Client,
  ClientWithIssuer,
} from "@/lib/types";

/**
 * Every client of a business, or only the ones it invoices.
 *
 * A cash client is never billed and never appears on a document, so anything
 * that leads to an invoice asks for `invoiceable` and never sees them: the new
 * invoice form, the edit form, the backup workbook. The savings dashboard and
 * the client list ask for all of them, because there they are the point.
 *
 * This filter is a convenience, not the guarantee. `create_invoice` in Postgres
 * refuses a cash client outright, which is what makes the rule true for agents
 * and for any page written after this one.
 */
export async function listClients(
  orgId: string,
  opts: { invoiceable?: boolean } = {},
): Promise<ClientWithIssuer[]> {
  const supabase = createAdminClient();
  let query = supabase
    .from("clients")
    .select("*, issuer:issuers!clients_default_issuer_id_fkey(short_name, abn)")
    .eq("org_id", orgId);
  if (opts.invoiceable) query = query.eq("billing_type", "invoice");
  const { data, error } = await query.order("name");
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
  billing_type?: BillingType;
  cadence?: Cadence;
  cadence_weeks?: number | null;
};

/**
 * The org is stamped here rather than taken from the input, so a caller cannot
 * file a client under somebody else's business. The trial quota is enforced by
 * a trigger in Postgres, which is what makes it apply to agents too.
 */
/** One client of this business, or null. */
export async function getClient(
  orgId: string,
  id: string,
): Promise<ClientWithIssuer | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("clients")
    .select("*, issuer:issuers(short_name, abn)")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load the client: ${error.message}`);
  return (data as ClientWithIssuer | null) ?? null;
}

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

/**
 * `is_active` is not part of `ClientInput` because it is not something a person
 * types into the client form: it is a state the client is put into, from the
 * list or by an agent. A client who no longer uses the business is archived,
 * never deleted, so their invoices keep the name they were billed under.
 */
export type ClientPatch = Partial<ClientInput> & {
  is_active?: boolean;
  in_week_1?: boolean;
  in_week_2?: boolean;
  week_1_day?: number | null;
  week_2_day?: number | null;
  week_1_seq?: number | null;
  week_2_seq?: number | null;
};

/**
 * Place a client in one of the two rotation weeks, on a day, or take them out.
 *
 * The two weeks are independent: a client done every week is in both, and one
 * with no rhythm is in neither and gets recorded in whichever week the work
 * actually happened. So this touches one week and never the other.
 *
 * `day` null with `on` true is the real state of a client who belongs to the
 * week but has not been given a day yet. Removing clears the day as well, so a
 * client brought back later does not arrive with a day nobody chose.
 *
 * Being placed always sends the client to the END of the week's order, which is
 * what puts them at the bottom of the day they were moved to rather than into
 * the middle of it carrying a position that meant something somewhere else.
 */
export async function setClientRotation(
  orgId: string,
  id: string,
  week: 1 | 2,
  on: boolean,
  day: number | null = null,
): Promise<Client> {
  const seqColumn = week === 1 ? "week_1_seq" : "week_2_seq";

  let seq: number | null = null;
  if (on) {
    const supabase = createAdminClient();
    const { data: last } = await supabase
      .from("clients")
      .select(seqColumn)
      .eq("org_id", orgId)
      .eq(week === 1 ? "in_week_1" : "in_week_2", true)
      .order(seqColumn, { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    seq = (((last as Record<string, number | null> | null)?.[seqColumn] ?? 0) as number) + 1;
  }

  const patch: ClientPatch =
    week === 1
      ? { in_week_1: on, week_1_day: on ? day : null, week_1_seq: seq }
      : { in_week_2: on, week_2_day: on ? day : null, week_2_seq: seq };
  return updateClient(orgId, id, patch);
}

export async function updateClient(
  orgId: string,
  id: string,
  input: ClientPatch,
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

/**
 * Archive a client, or bring them back.
 *
 * Archiving is what should happen to a client who has stopped using the
 * business: they disappear from the pickers where a new invoice is raised, and
 * they stay everywhere their history is. Deleting is for a client entered by
 * mistake, and only ever for one who has never been invoiced.
 */
export async function setClientActive(
  orgId: string,
  id: string,
  active: boolean,
): Promise<Client> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("clients")
    .update({ is_active: active })
    .eq("org_id", orgId)
    .eq("id", id)
    .select("*")
    .single();
  if (error) {
    throw new Error(
      `Failed to ${active ? "restore" : "archive"} client: ${error.message}`,
    );
  }
  return data as Client;
}
