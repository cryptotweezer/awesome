"use server";

import { revalidatePath } from "next/cache";
import { requireOrg, updateOrgSettings } from "@/lib/data/org";
import { createAdminClient } from "@/lib/supabase/admin";
import { LOGO_BUCKET } from "@/lib/pdf/logo";

export type SettingsState = { ok: boolean; error?: string; saved?: boolean };

function str(form: FormData, key: string): string | null {
  const v = (form.get(key) as string | null)?.trim();
  return v ? v : null;
}

const ENTITY_TYPES = [
  "sole_trader",
  "company",
  "partnership",
  "trust",
] as const;
const TAX_LABELS = ["ABN", "TFN", "ACN"] as const;

/**
 * Edit the business details that end up printed on documents.
 *
 * Deliberately NOT editable here: the tax number itself and the issuer behind
 * it. Changing the ABN on a live business is a different, rarer operation than
 * fixing a typo in an address, and past invoices carry their own snapshot of it
 * anyway. Same reasoning as never letting a rate change rewrite old invoices.
 */
export async function saveSettingsAction(
  _prev: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  const { org } = await requireOrg();

  const name = str(form, "name");
  if (!name) return { ok: false, error: "Your business name is required." };

  const termsRaw = str(form, "terms_days");
  const termsDays = termsRaw === null ? org.terms_days : Number(termsRaw);
  if (!Number.isInteger(termsDays) || termsDays < 0 || termsDays > 365) {
    return { ok: false, error: "Payment terms must be a number of days." };
  }

  const entityType = str(form, "entity_type");
  const taxLabel = str(form, "tax_id_label");

  try {
    await updateOrgSettings(org.id, {
      name,
      entity_type: ENTITY_TYPES.includes(
        entityType as (typeof ENTITY_TYPES)[number],
      )
        ? (entityType as (typeof ENTITY_TYPES)[number])
        : org.entity_type,
      tax_id_label: TAX_LABELS.includes(taxLabel as (typeof TAX_LABELS)[number])
        ? (taxLabel as (typeof TAX_LABELS)[number])
        : org.tax_id_label,
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
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not save the changes.",
    };
  }

  // The business name and address are printed on every document, so nothing
  // that renders them may keep a stale copy.
  revalidatePath("/", "layout");
  return { ok: true, saved: true };
}

const MAX_LOGO_BYTES = 1_048_576; // 1 MB, matching the bucket's own limit
const LOGO_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
};

/**
 * Upload the logo printed on this business's documents.
 *
 * The path is derived from the organisation id, never from the file name, so
 * one business can neither overwrite another's logo nor escape its own folder
 * with a crafted name. The type and size are checked here and again by the
 * bucket itself.
 */
export async function uploadLogoAction(
  _prev: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  const { org } = await requireOrg();

  const file = form.get("logo");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose an image first." };
  }
  const ext = LOGO_TYPES[file.type];
  if (!ext) return { ok: false, error: "The logo must be a PNG or a JPEG." };
  if (file.size > MAX_LOGO_BYTES) {
    return { ok: false, error: "The logo must be smaller than 1 MB." };
  }

  const supabase = createAdminClient();
  const path = `${org.id}/logo.${ext}`;
  const { error } = await supabase.storage
    .from(LOGO_BUCKET)
    .upload(path, await file.arrayBuffer(), {
      contentType: file.type,
      upsert: true,
    });
  if (error) return { ok: false, error: `Upload failed: ${error.message}` };

  // Switching format leaves the old file behind, so clear it out.
  const stale = ext === "png" ? `${org.id}/logo.jpg` : `${org.id}/logo.png`;
  await supabase.storage.from(LOGO_BUCKET).remove([stale]);

  try {
    await updateOrgSettings(org.id, { logo_path: path });
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
