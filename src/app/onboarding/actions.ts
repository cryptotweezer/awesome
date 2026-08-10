"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg, createOrg, updateOrgSettings } from "@/lib/data/org";
import { storeOrgLogo } from "@/lib/data/logo-upload";
import { isAllowedEmail, isGuestSignupEnabled } from "@/lib/auth";

export type OnboardingState = {
  ok: boolean;
  error?: string;
  /**
   * Everything that was typed, handed back so a rejected form can be filled in
   * again rather than from scratch. React resets a form once its action
   * returns, so without this a wrong ABN costs the whole page of details.
   */
  values?: Record<string, string>;
  /** Whether a logo was chosen and lost in that reset. Files cannot be given back. */
  logoLost?: boolean;
  /** Bumped on every answer, so the fields remount with the values above. */
  attempt?: number;
};

function str(form: FormData, key: string): string | null {
  const v = (form.get(key) as string | null)?.trim();
  return v ? v : null;
}

/** Everything typed into the form, as strings. The file is not one of them. */
function typedValues(form: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

const ENTITY_TYPES = ["sole_trader", "company", "partnership", "trust"] as const;

function oneOf<T extends readonly string[]>(
  allowed: T,
  value: string | null,
  fallback: T[number],
): T[number] {
  return allowed.includes(value as T[number]) ? (value as T[number]) : fallback;
}

/** Spaces are how people read a number out; digits are the number. */
function digits(value: string | null): string {
  return (value ?? "").replace(/\D/g, "");
}

/**
 * Create the signed-in user's business. Everything that decides WHO this is
 * comes from the session, never from the form, so the only thing the browser
 * gets to choose is the content of the business details.
 */
export async function createOrgAction(
  _prev: OnboardingState,
  form: FormData,
): Promise<OnboardingState> {
  const logo = form.get("logo");
  const hasLogo = logo instanceof File && logo.size > 0;

  /** Every refusal hands the typed details back with it. */
  const refuse = (error: string): OnboardingState => ({
    ok: false,
    error,
    values: typedValues(form),
    logoLost: hasLogo,
    attempt: (_prev.attempt ?? 0) + 1,
  });

  const auth = await createClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user?.email) return refuse("Sign in first.");

  // The same gate as the proxy and the OAuth callback. Without it, a closed
  // deployment could still be signed up to by anyone who found this action.
  if (!isAllowedEmail(user.email) && !isGuestSignupEnabled()) {
    return refuse("This app is not open for signups yet.");
  }

  if (await getCurrentOrg()) {
    return refuse("This account already has a business.");
  }

  const name = str(form, "name");
  if (!name) return refuse("Your business name is required.");

  // Checked here as well as in the database, so the answer is a sentence about
  // ABNs rather than whatever Postgres says about a failed constraint.
  const abn = digits(str(form, "tax_id"));
  if (abn.length !== 11) {
    return refuse("An ABN is eleven digits.");
  }
  const acn = digits(str(form, "acn"));
  if (acn && acn.length !== 9) {
    return refuse("An ACN is nine digits.");
  }

  const termsRaw = str(form, "terms_days");
  const termsDays = termsRaw === null ? 7 : Number(termsRaw);
  if (!Number.isInteger(termsDays) || termsDays < 0 || termsDays > 365) {
    return refuse("Payment terms must be a number of days.");
  }

  let orgId: string;
  try {
    const org = await createOrg(
      { id: user.id, email: user.email },
      {
        name,
        issuer_name: str(form, "issuer_name") ?? name,
        tax_id: abn,
        acn: acn || null,
        tax_id_label: "ABN",
        entity_type: oneOf(ENTITY_TYPES, str(form, "entity_type"), "sole_trader"),
        address_line: str(form, "address_line"),
        suburb: str(form, "suburb"),
        state: str(form, "state"),
        postcode: str(form, "postcode"),
        // Left blank, the account's own email is used. It is not offered as a
        // placeholder: an example filled in with your own details is easy to
        // mistake for a value that was saved.
        email: str(form, "email") ?? user.email,
        phone: str(form, "phone"),
        bank_name: str(form, "bank_name"),
        bank_bsb: str(form, "bank_bsb"),
        bank_account_no: str(form, "bank_account_no"),
        bank_account_name: str(form, "bank_account_name"),
        payment_note: str(form, "payment_note"),
        terms_days: termsDays,
        timezone: str(form, "timezone") ?? "Australia/Sydney",
        display_name: str(form, "display_name") ?? user.email.split("@")[0],
      },
    );
    orgId = org.id;
  } catch (e) {
    return refuse(
      e instanceof Error ? e.message : "Could not create the business.",
    );
  }

  // GST is not one of create_org's arguments: it decides how invoices are
  // issued, not who the business is. Saved right after, so somebody who is
  // registered does not have to remember to switch it on before invoice #1.
  if (form.get("gst_registered") === "on") {
    try {
      await updateOrgSettings(orgId, { gst_registered: true });
    } catch {
      // It can be turned on in Business details; losing the account cannot be
      // undone there, so nothing here is allowed to fail the signup.
    }
  }

  // The logo comes second because it is stored under the organisation id, which
  // did not exist a moment ago. It never fails the signup: a logo can be added
  // later from Business details, a lost account cannot.
  if (hasLogo) {
    const stored = await storeOrgLogo(orgId, logo as File);
    if ("path" in stored) {
      try {
        await updateOrgSettings(orgId, { logo_path: stored.path });
      } catch {
        // Same reasoning: the business exists, and that is what matters.
      }
    }
  }

  // Without this the layout keeps serving its cached "there is no business
  // yet" branch, so saving looks like it did nothing and trying again says the
  // account already has a business. That is the bug Andres hit on 2026-08-10.
  revalidatePath("/", "layout");
  redirect("/");
}
