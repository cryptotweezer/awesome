"use server";

import { revalidatePath } from "next/cache";
import {
  mintAgentKey,
  setAgentKeyActive,
  deleteAgentKey,
} from "@/lib/data/agent-keys";
import { requireOrg } from "@/lib/data/org";

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
  try {
    const { org } = await requireOrg();
    const { key } = await mintAgentKey(org.id, label);
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
