"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg, createOrg } from "@/lib/data/org";
import { isAllowedEmail, isGuestSignupEnabled } from "@/lib/auth";

export type OnboardingState = { ok: boolean; error?: string };

function str(form: FormData, key: string): string | null {
  const v = (form.get(key) as string | null)?.trim();
  return v ? v : null;
}

const ENTITY_TYPES = ["sole_trader", "company", "partnership", "trust"] as const;
const TAX_LABELS = ["ABN", "TFN", "ACN"] as const;

function oneOf<T extends readonly string[]>(
  allowed: T,
  value: string | null,
  fallback: T[number],
): T[number] {
  return allowed.includes(value as T[number]) ? (value as T[number]) : fallback;
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
  const auth = await createClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user?.email) return { ok: false, error: "Sign in first." };

  // The same gate as the proxy and the OAuth callback. Without it, a closed
  // deployment could still be signed up to by anyone who found this action.
  if (!isAllowedEmail(user.email) && !isGuestSignupEnabled()) {
    return { ok: false, error: "This app is not open for signups yet." };
  }

  if (await getCurrentOrg()) {
    return { ok: false, error: "This account already has a business." };
  }

  const name = str(form, "name");
  if (!name) return { ok: false, error: "Your business name is required." };

  const taxIdLabel = oneOf(TAX_LABELS, str(form, "tax_id_label"), "ABN");
  const taxId = str(form, "tax_id");
  if (!taxId) return { ok: false, error: `Your ${taxIdLabel} is required.` };

  const termsRaw = str(form, "terms_days");
  const termsDays = termsRaw === null ? 7 : Number(termsRaw);
  if (!Number.isInteger(termsDays) || termsDays < 0 || termsDays > 365) {
    return { ok: false, error: "Payment terms must be a number of days." };
  }

  try {
    await createOrg(
      { id: user.id, email: user.email },
      {
        name,
        issuer_name: str(form, "issuer_name") ?? name,
        tax_id: taxId,
        tax_id_label: taxIdLabel,
        entity_type: oneOf(ENTITY_TYPES, str(form, "entity_type"), "sole_trader"),
        address_line: str(form, "address_line"),
        suburb: str(form, "suburb"),
        state: str(form, "state"),
        postcode: str(form, "postcode"),
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
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not create the business.",
    };
  }

  redirect("/");
}
