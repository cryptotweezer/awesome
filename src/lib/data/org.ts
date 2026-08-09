import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Org, OrgMember } from "@/lib/types";

/**
 * Organisation resolution. Every read and every write in this app is scoped to
 * one org, and this is where that org comes from.
 *
 * There are exactly two ways in:
 *   - a signed-in person   -> getCurrentOrg(), from the session cookie
 *   - an agent with a key  -> the gateway, from awesome.agent_keys.org_id
 *
 * Nothing else may invent an org id. Note that `auth.users` is shared with the
 * resume and pis projects, so having an account there means nothing here:
 * membership in `awesome.org_members` is the only thing that grants access.
 */

/** The original business. Fixed so migrations, seeds and code can all name it. */
export const AWESOME_ORG_ID = "00000000-0000-0000-0000-000000000001";

export type OrgContext = {
  org: Org;
  member: OrgMember;
};

/**
 * The signed-in user's organisation, or null if they have none yet (a brand new
 * account that still has to go through onboarding).
 *
 * Cached per request: a single page render asks for this from the layout, the
 * page and several data helpers, and one round trip is enough.
 */
export const getCurrentOrg = cache(async (): Promise<OrgContext | null> => {
  const auth = await createClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return null;

  const db = createAdminClient();
  const { data, error } = await db
    .from("org_members")
    .select("*, org:orgs(*)")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw new Error(`Failed to resolve organisation: ${error.message}`);
  if (!data) return null;

  const { org, ...member } = data as unknown as OrgMember & { org: Org };
  return { org, member };
});

/**
 * Same, but for code paths that cannot sensibly continue without one. Pages are
 * expected to have been through the proxy, so reaching here without an org is a
 * bug rather than a user state.
 */
export async function requireOrg(): Promise<OrgContext> {
  const ctx = await getCurrentOrg();
  if (!ctx) throw new Error("No organisation for the current session");
  return ctx;
}

/** Load one org by id. Used by the gateway, which authenticates by key. */
export async function getOrg(orgId: string): Promise<Org | null> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("orgs")
    .select("*")
    .eq("id", orgId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load organisation: ${error.message}`);
  return (data as Org) ?? null;
}

/**
 * How this org signs the invoices it creates by hand. Falls back to the email
 * so a signature is never blank, which the DB rejects.
 */
export function signatureFor(member: OrgMember): string {
  return member.display_name?.trim() || member.email;
}

export type NewOrgInput = {
  /** The business name, printed on every document. */
  name: string;
  /** Who holds the ABN or TFN. Often the same as the business name. */
  issuer_name: string;
  tax_id: string;
  tax_id_label: "ABN" | "TFN" | "ACN";
  entity_type: "sole_trader" | "company" | "partnership" | "trust";
  address_line: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  email: string | null;
  phone: string | null;
  bank_name: string | null;
  bank_bsb: string | null;
  bank_account_no: string | null;
  bank_account_name: string | null;
  payment_note: string | null;
  terms_days: number;
  timezone: string;
  /** How this person signs the invoices they create by hand. */
  display_name: string;
};

/**
 * Turn a signed-in user into a working business. The organisation, the
 * membership and the single issuer are created together in one DB function, so
 * a failure never leaves somebody signed in with half an account.
 */
export async function createOrg(
  user: { id: string; email: string },
  input: NewOrgInput,
): Promise<Org> {
  const db = createAdminClient();
  const { data, error } = await db.rpc("create_org", {
    p_user_id: user.id,
    p_email: user.email,
    p_display_name: input.display_name,
    p_name: input.name,
    p_issuer_name: input.issuer_name,
    p_tax_id: input.tax_id,
    p_tax_id_label: input.tax_id_label,
    p_entity_type: input.entity_type,
    p_address_line: input.address_line,
    p_suburb: input.suburb,
    p_state: input.state,
    p_postcode: input.postcode,
    p_contact_email: input.email,
    p_phone: input.phone,
    p_bank_name: input.bank_name,
    p_bank_bsb: input.bank_bsb,
    p_bank_account_no: input.bank_account_no,
    p_bank_account_name: input.bank_account_name,
    p_payment_note: input.payment_note,
    p_terms_days: input.terms_days,
    p_timezone: input.timezone,
  });
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create the business");
  }
  return data as Org;
}

/**
 * Everything the settings page can change about an existing business.
 *
 * The tax number and the issuer holding it are deliberately absent: past
 * invoices carry their own snapshot of both, and changing the entity behind a
 * live business is a different operation from fixing a typo in an address.
 */
export type OrgSettingsInput = Omit<
  NewOrgInput,
  "issuer_name" | "tax_id" | "display_name"
> & {
  logo_path: string | null;
};

export async function updateOrgSettings(
  orgId: string,
  input: Partial<OrgSettingsInput>,
): Promise<Org> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("orgs")
    .update(input)
    .eq("id", orgId)
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(`Failed to save the business details: ${error?.message}`);
  }
  return data as Org;
}

/**
 * Tick (or untick) steps of the setup checklist.
 *
 * Merged rather than replaced, so two tabs racing on different steps cannot
 * wipe each other's progress.
 */
export async function updateOrgOnboarding(
  orgId: string,
  steps: Record<string, boolean>,
): Promise<void> {
  const db = createAdminClient();
  const { data, error: readError } = await db
    .from("orgs")
    .select("onboarding")
    .eq("id", orgId)
    .single();
  if (readError) throw new Error(`Failed to read progress: ${readError.message}`);

  const merged = { ...((data?.onboarding as object) ?? {}), ...steps };
  const { error } = await db
    .from("orgs")
    .update({ onboarding: merged })
    .eq("id", orgId);
  if (error) throw new Error(`Failed to save progress: ${error.message}`);
}

/** Demo orgs get purged after a month of silence, so mark them as alive. */
export async function touchOrgActivity(orgId: string): Promise<void> {
  const db = createAdminClient();
  await db
    .from("orgs")
    .update({ last_active_at: new Date().toISOString() })
    .eq("id", orgId);
}
