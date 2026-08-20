"use server";

import { revalidatePath } from "next/cache";
import {
  mintAgentKey,
  setAgentKeyActive,
  deleteAgentKey,
} from "@/lib/data/agent-keys";
import { requireOrg } from "@/lib/data/org";
import { parseScopes } from "@/lib/gateway/scopes";
import { deleteConnection, revokeConnection } from "@/lib/oauth/store";

export type KeyActionState = {
  ok: boolean;
  error?: string;
  /** The raw key, present only right after minting (shown once). */
  key?: string;
  label?: string;
};

const initialError = (e: unknown): string =>
  e instanceof Error ? e.message : "Action failed.";

export async function mintKeyAction(
  _prev: KeyActionState,
  formData: FormData,
): Promise<KeyActionState> {
  const label = (formData.get("label") as string | null)?.trim();
  if (!label) return { ok: false, error: "Label is required." };

  const scopes = parseScopes(formData.getAll("scope").map(String));
  if (scopes.length === 0) {
    return { ok: false, error: "Pick at least one thing this key may do." };
  }

  // A date, or nothing. An expiry the person did not ask for would strand an
  // agent on a day nobody remembers choosing.
  const expiry = (formData.get("expires_at") as string | null)?.trim();
  const expiresAt = expiry ? new Date(`${expiry}T23:59:59Z`).toISOString() : null;
  if (expiry && Number.isNaN(Date.parse(expiresAt ?? ""))) {
    return { ok: false, error: "That expiry date is not a date." };
  }

  try {
    const { org } = await requireOrg();
    const { key } = await mintAgentKey(org.id, label, { scopes, expiresAt });
    revalidatePath("/agent-keys");
    return { ok: true, key, label };
  } catch (e) {
    return { ok: false, error: initialError(e) };
  }
}

export async function revokeKeyAction(
  _prev: KeyActionState,
  formData: FormData,
): Promise<KeyActionState> {
  const id = formData.get("id") as string;
  try {
    const { org } = await requireOrg();
    await setAgentKeyActive(org.id, id, false);
    revalidatePath("/agent-keys");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: initialError(e) };
  }
}

export async function reactivateKeyAction(
  _prev: KeyActionState,
  formData: FormData,
): Promise<KeyActionState> {
  const id = formData.get("id") as string;
  try {
    const { org } = await requireOrg();
    await setAgentKeyActive(org.id, id, true);
    revalidatePath("/agent-keys");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: initialError(e) };
  }
}

export async function deleteKeyAction(
  _prev: KeyActionState,
  formData: FormData,
): Promise<KeyActionState> {
  const id = formData.get("id") as string;
  try {
    const { org } = await requireOrg();
    await deleteAgentKey(org.id, id);
    revalidatePath("/agent-keys");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: initialError(e) };
  }
}

/**
 * Cut off an assistant that connected through OAuth. Both of its tokens die,
 * so it stops immediately and cannot refresh itself back to life. The person
 * can always connect it again, which is why this is not a confirmation-heavy
 * action.
 */
export async function revokeConnectionAction(
  _prev: KeyActionState,
  formData: FormData,
): Promise<KeyActionState> {
  const id = formData.get("id") as string;
  try {
    const { org } = await requireOrg();
    await revokeConnection(org.id, id);
    revalidatePath("/agent-keys");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: initialError(e) };
  }
}

/** Remove a revoked connection's row once it is of no further interest. */
export async function deleteConnectionAction(
  _prev: KeyActionState,
  formData: FormData,
): Promise<KeyActionState> {
  const id = formData.get("id") as string;
  try {
    const { org } = await requireOrg();
    await deleteConnection(org.id, id);
    revalidatePath("/agent-keys");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: initialError(e) };
  }
}
