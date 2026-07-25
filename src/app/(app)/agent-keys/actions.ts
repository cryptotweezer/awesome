"use server";

import { revalidatePath } from "next/cache";
import {
  mintAgentKey,
  setAgentKeyActive,
  deleteAgentKey,
} from "@/lib/data/agent-keys";

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
    const { key } = await mintAgentKey(label);
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
    await setAgentKeyActive(id, false);
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
    await setAgentKeyActive(id, true);
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
    await deleteAgentKey(id);
    revalidatePath("/agent-keys");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: initialError(e) };
  }
}
