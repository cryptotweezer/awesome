"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  deleteDemoOrg,
  requireOrg,
  updateIssuer,
  updateMemberName,
  updateOrgSettings,
} from "@/lib/data/org";
import { listIssuers } from "@/lib/data/issuers";
import { storeOrgLogo } from "@/lib/data/logo-upload";
import { createAdminClient } from "@/lib/supabase/admin";
import { LOGO_BUCKET } from "@/lib/pdf/logo";

export type SettingsState = {
  ok: boolean;
  error?: string;
  saved?: boolean;
  /** What was typed, when the save was refused. React clears the form on its own. */
  values?: Record<string, string>;
  /** Bumped on every answer, so the fields remount with those values. */
  attempt?: number;
};

function str(form: FormData, key: string): string | null {
  const v = (form.get(key) as string | null)?.trim();
  return v ? v : null;
}

/** Everything typed into the form, as strings. */
function typedValues(form: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

const ENTITY_TYPES = [
  "sole_trader",
  "company",
  "partnership",
  "trust",
] as const;

/** Spaces are how people read a number out; digits are the number. */
function digits(value: string | null): string {
  return (value ?? "").replace(/\D/g, "");
}

/**
 * Edit the business details that end up printed on documents.
 *
 * The tax numbers are editable only when the business has exactly one entity
 * behind its invoices, which is every business except Awesome. With two ABNs
 * there is no single value this form could stand for, so the fields are not
 * rendered and nothing here touches them. Editing them never rewrites history
 * either way: an invoice snapshots the name and the ABN it was issued under.
 */
export async function saveSettingsAction(
  _prev: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  const { org, member } = await requireOrg();

  /** Every refusal hands the typed details back with it. */
  const refuse = (error: string): SettingsState => ({
    ok: false,
    error,
    values: typedValues(form),
    attempt: (_prev.attempt ?? 0) + 1,
  });

  const name = str(form, "name");
  if (!name) return refuse("Your business name is required.");

  const termsRaw = str(form, "terms_days");
  const termsDays = termsRaw === null ? org.terms_days : Number(termsRaw);
  if (!Number.isInteger(termsDays) || termsDays < 0 || termsDays > 365) {
    return refuse("Payment terms must be a number of days.");
  }

  const entityType = str(form, "entity_type");

  // The tax numbers, only when this business has one entity and the form
  // therefore showed them. Validated here as well as in the database, so the
  // answer is a sentence about ABNs and not a constraint violation.
  const issuers = await listIssuers(org.id);
  const sole = issuers.length === 1 ? issuers[0] : null;
  const abn = sole ? digits(str(form, "tax_id")) : "";
  const acn = sole ? digits(str(form, "acn")) : "";
  if (sole) {
    if (abn.length !== 11) return refuse("An ABN is eleven digits.");
    if (acn && acn.length !== 9) return refuse("An ACN is nine digits.");
  }

  try {
    await updateOrgSettings(org.id, {
      name,
      entity_type: ENTITY_TYPES.includes(
        entityType as (typeof ENTITY_TYPES)[number],
      )
        ? (entityType as (typeof ENTITY_TYPES)[number])
        : org.entity_type,
      address_line: str(form, "address_line"),
      suburb: str(form, "suburb"),
      state: str(form, "state"),
      postcode: str(form, "postcode"),
      email: str(form, "email"),
      phone: str(form, "phone"),
      bank_name: str(form, "bank_name"),
      bank_bsb: str(form, "bank_bsb"),
      bank_account_no: str(form, "bank_account_no"),
      bank_account_name: str(form, "bank_account_name"),
      payment_note: str(form, "payment_note"),
      terms_days: termsDays,
      timezone: str(form, "timezone") ?? org.timezone,
      // Empty means the work is described line by line, which is why this is
      // stored as "" and not as null: there is no third state.
      default_service_description: str(form, "default_service_description") ?? "",
      per_client_defaults: form.get("per_client_defaults") === "on",
      // Only ever decides how NEW invoices are issued: each one freezes the
      // rate it was created under.
      gst_registered: form.get("gst_registered") === "on",
    });

    if (sole) {
      await updateIssuer(org.id, sole.id, {
        full_name: str(form, "issuer_name") ?? name,
        abn,
        acn: acn || null,
      });
    }

    // Blank means "use the account email", the same rule as at sign-up.
    await updateMemberName(
      org.id,
      member.user_id,
      str(form, "display_name") ?? member.email.split("@")[0],
    );
  } catch (e) {
    return refuse(
      e instanceof Error ? e.message : "Could not save the changes.",
    );
  }

  // The business name and address are printed on every document, so nothing
  // that renders them may keep a stale copy.
  revalidatePath("/", "layout");
  return { ok: true, saved: true, attempt: (_prev.attempt ?? 0) + 1 };
}

/** Upload the logo printed on this business's documents. */
export async function uploadLogoAction(
  _prev: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  const { org } = await requireOrg();

  const file = form.get("logo");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose an image first." };
  }

  const stored = await storeOrgLogo(org.id, file);
  if ("error" in stored) return { ok: false, error: stored.error };

  try {
    await updateOrgSettings(org.id, { logo_path: stored.path });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not save the logo.",
    };
  }

  revalidatePath("/", "layout");
  return { ok: true, saved: true };
}

/** Go back to no logo at all. Documents then print the name only. */
export async function removeLogoAction(): Promise<SettingsState> {
  const { org } = await requireOrg();
  if (!org.logo_path) return { ok: true };

  const supabase = createAdminClient();
  await supabase.storage.from(LOGO_BUCKET).remove([org.logo_path]);
  try {
    await updateOrgSettings(org.id, { logo_path: null });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not remove the logo.",
    };
  }

  revalidatePath("/", "layout");
  return { ok: true, saved: true };
}

/**
 * Close a trial account, on purpose and immediately.
 *
 * Three fences, in this order: the organisation comes from the session and
 * never from the form, so nobody can name somebody else's business; the name
 * has to be typed back, because a button alone is not consent to lose your
 * data; and the database refuses anything that is not a trial, which is what
 * actually protects Awesome.
 *
 * The account is only signed out, not deleted: the same Supabase user signs in
 * to other applications on this project. Signing up again produces a brand new,
 * empty business, which is exactly what the person asked for.
 */
export async function deleteAccountAction(
  _prev: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  const { org } = await requireOrg();

  const typed = str(form, "confirm_name");
  const expected = (org.display_name ?? org.name).trim();
  if (typed !== expected) {
    return {
      ok: false,
      error: `Type "${expected}" exactly to confirm.`,
    };
  }

  try {
    await deleteDemoOrg(org.id);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not delete the account.",
    };
  }

  // Object storage is outside the database and outside its transaction, so the
  // logo goes last and never fails the deletion: a stray file costs kilobytes,
  // a half-deleted account costs trust.
  try {
    if (org.logo_path) {
      const supabase = createAdminClient();
      await supabase.storage.from(LOGO_BUCKET).remove([org.logo_path]);
    }
  } catch {
    // Nothing to do about it, and nothing depends on it.
  }

  redirect("/auth/signout");
}
