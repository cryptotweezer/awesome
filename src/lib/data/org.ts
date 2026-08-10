import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
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

/**
 * The business a dashboard page belongs to.
 *
 * Every page except two needs one to show anything at all, so an account with
 * no business is sent to the overview, which is the one page that has an empty
 * state and where the tour runs. The two exceptions call getCurrentOrg
 * directly: the overview itself, and Business details, where the business is
 * created.
 *
 * Nothing in the interface links here while there is no business (the
 * navigation and the cards are disabled), so this only catches a typed URL.
 */
export async function orgForPage(): Promise<Org> {
  const org = (await getCurrentOrg())?.org;
  if (!org) redirect("/");
  return org;
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
  /** The legal name the ABN is registered to. Often the business name. */
  issuer_name: string;
  /** The ABN. Eleven digits; anything else is rejected by the database. */
  tax_id: string;
  /** A company's ACN, nine digits, printed under the ABN. */
  acn: string | null;
  tax_id_label: "ABN" | "ACN";
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
    p_acn: input.acn,
  });
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create the business");
  }
  return data as Org;
}

/**
 * Everything the settings page can change about an existing business.
 *
 * The tax number and the entity holding it are not here because they live on
 * `issuers`, not on the org: see updateIssuer below.
 */
export type OrgSettingsInput = Omit<
  NewOrgInput,
  "issuer_name" | "tax_id" | "acn" | "display_name"
> & {
  logo_path: string | null;
  /** The usual service, if there is one. "" means described per line. */
  default_service_description: string;
  /** Whether a client carries an agreed service and rate. */
  per_client_defaults: boolean;
  /** Whether new invoices are issued with 10% GST inside the price. */
  gst_registered: boolean;
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
 * Correct the entity whose tax number is printed: its legal name, its ABN and
 * its optional ACN.
 *
 * Nothing already issued moves, because every invoice carries its own snapshot
 * of the name and the ABN, the same way a line item carries its own rate. The
 * database validates the digits and the ownership, so a wrong org id here buys
 * nothing.
 */
export async function updateIssuer(
  orgId: string,
  issuerId: string,
  input: { full_name: string; abn: string; acn: string | null },
): Promise<void> {
  const db = createAdminClient();
  const { error } = await db.rpc("update_issuer", {
    p_org_id: orgId,
    p_issuer_id: issuerId,
    p_full_name: input.full_name,
    p_abn: input.abn,
    p_acn: input.acn,
  });
  if (error) throw new Error(error.message);
}

/** Who signs the invoices this person creates by hand. */
export async function updateMemberName(
  orgId: string,
  userId: string,
  displayName: string,
): Promise<void> {
  const db = createAdminClient();
  const { error } = await db
    .from("org_members")
    .update({ display_name: displayName })
    .eq("org_id", orgId)
    .eq("user_id", userId);
  if (error) throw new Error(`Failed to save your name: ${error.message}`);
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

/**
 * Close a trial account and take everything with it: the business, the
 * membership, the issuers, the clients, the invoices, the line items and the
 * agent keys. The logo lives in object storage and is removed by the caller.
 *
 * The Supabase user is deliberately left alone. That account is shared with the
 * other projects in this Supabase instance, so deleting it here would sign
 * somebody out of applications that have nothing to do with billing.
 *
 * Refusing anything that is not a trial is the database's job, not this
 * function's, so no bug on this side can widen it.
 */
export async function deleteDemoOrg(orgId: string): Promise<string> {
  const db = createAdminClient();
  const { data, error } = await db.rpc("delete_demo_org", { p_org_id: orgId });
  if (error) throw new Error(`Failed to delete the business: ${error.message}`);
  return (data as string) ?? "";
}

/**
 * Record that somebody signed in. The purge no longer reads this (a trial ends
 * a month after sign-up, busy or not), so it is kept only as a "last seen"
 * signal for support questions.
 */
export async function touchOrgActivity(orgId: string): Promise<void> {
  const db = createAdminClient();
  await db
    .from("orgs")
    .update({ last_active_at: new Date().toISOString() })
    .eq("id", orgId);
}
