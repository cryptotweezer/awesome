"use server";

import { revalidatePath } from "next/cache";
import {
  createClient,
  updateClient,
  deleteClient,
  setClientActive,
  type ClientInput,
} from "@/lib/data/clients";
import { requireOrg } from "@/lib/data/org";

export type ActionState = { ok: boolean; error?: string };

function str(formData: FormData, key: string): string | null {
  const v = (formData.get(key) as string | null)?.trim();
  return v ? v : null;
}

export async function saveClientAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = str(formData, "id");
  const name = str(formData, "name");
  if (!name) return { ok: false, error: "Name is required." };

  const rateRaw = str(formData, "default_rate");
  const rate = rateRaw === null ? null : Number(rateRaw);
  if (rate !== null && (Number.isNaN(rate) || rate < 0)) {
    return { ok: false, error: "Rate must be a valid number." };
  }

  const input: ClientInput = {
    name,
    address_line: str(formData, "address_line"),
    suburb: str(formData, "suburb"),
    state: str(formData, "state") ?? "NSW",
    postcode: str(formData, "postcode"),
    email: str(formData, "email"),
    default_issuer_id: str(formData, "default_issuer_id"),
    // Left out of the form entirely by businesses that describe the work on
    // each invoice line, which is most of them.
    default_description: str(formData, "default_description"),
    default_rate: rate,
  };

  // Only the savings form carries these. Absent means untouched rather than
  // cleared, which is what keeps the ordinary client form, and every business
  // that uses it, exactly as it was.
  const billingType = str(formData, "billing_type");
  if (billingType) {
    if (!["invoice", "transfer", "cash"].includes(billingType)) {
      return { ok: false, error: "Unknown payment type." };
    }
    input.billing_type = billingType as typeof input.billing_type;
  }

  const cadence = str(formData, "cadence");
  if (cadence) {
    const allowed = [
      "weekly",
      "fortnightly",
      "monthly",
      "every_n_weeks",
      "occasional",
    ];
    if (!allowed.includes(cadence)) {
      return { ok: false, error: "Unknown frequency." };
    }
    input.cadence = cadence as ClientInput["cadence"];

    // The number of weeks means nothing for any other cadence, so it is
    // cleared rather than left behind to confuse the next reader.
    if (cadence === "every_n_weeks") {
      const weeks = Number(str(formData, "cadence_weeks"));
      if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52) {
        return { ok: false, error: "Weeks must be a whole number from 1 to 52." };
      }
      input.cadence_weeks = weeks;
    } else {
      input.cadence_weeks = null;
    }
  }

  try {
    const { org } = await requireOrg();
    if (id) {
      await updateClient(org.id, id, input);
    } else {
      await createClient(org.id, input);
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Save failed.",
    };
  }

  revalidatePath("/clients");
  revalidatePath("/savings/clients");
  revalidatePath("/");
  return { ok: true };
}

export async function deleteClientAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = str(formData, "id");
  if (!id) return { ok: false, error: "Missing client id." };
  try {
    const { org } = await requireOrg();
    await deleteClient(org.id, id);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Delete failed.",
    };
  }
  revalidatePath("/clients");
  revalidatePath("/savings/clients");
  revalidatePath("/");
  return { ok: true };
}

/**
 * Archive a client, or bring them back.
 *
 * This is what to do with a client who has stopped using the business, and it
 * is why deleting one is so rarely the answer: archiving takes them out of the
 * lists an invoice is raised from and leaves every invoice they were ever sent
 * exactly where it is.
 */
export async function setClientActiveAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = str(formData, "id");
  if (!id) return { ok: false, error: "Missing client id." };
  const active = formData.get("active") === "true";
  try {
    const { org } = await requireOrg();
    await setClientActive(org.id, id, active);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed.",
    };
  }
  revalidatePath("/clients");
  revalidatePath("/savings/clients");
  revalidatePath("/");
  return { ok: true };
}
