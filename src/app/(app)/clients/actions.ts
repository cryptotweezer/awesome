"use server";

import { revalidatePath } from "next/cache";
import {
  createClient,
  updateClient,
  deleteClient,
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
  revalidatePath("/");
  return { ok: true };
}
