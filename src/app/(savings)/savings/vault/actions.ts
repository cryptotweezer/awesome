"use server";

import { revalidatePath } from "next/cache";
import { AWESOME_ORG_ID, requireOrg, signatureFor } from "@/lib/data/org";
import { todayInSydney } from "@/lib/format";
import {
  deleteVaultMovement,
  recordVaultMovement,
  type VaultMovementInput,
} from "@/lib/data/vault";
import type { VaultMovementKind, VaultName } from "@/lib/types";

export type ActionState = { ok: boolean; error?: string };

function str(formData: FormData, key: string): string | null {
  const v = (formData.get(key) as string | null)?.trim();
  return v ? v : null;
}

function money(formData: FormData, key: string): number | null {
  const raw = str(formData, key);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** A server action is a public endpoint, so the gate cannot live in the page. */
async function awesome() {
  const ctx = await requireOrg();
  if (ctx.org.id !== AWESOME_ORG_ID) throw new Error("Not available.");
  return ctx;
}

export async function recordVaultMovementAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const kind = str(formData, "kind") as VaultMovementKind | null;
  if (kind !== "transfer" && kind !== "withdrawal" && kind !== "deposit") {
    return { ok: false, error: "Say what kind of movement this is." };
  }

  const amount = money(formData, "amount");
  if (amount === null || amount <= 0) {
    return { ok: false, error: "The amount must be more than 0." };
  }

  const vault = (str(formData, "vault") ?? "aus") as VaultName;
  if (vault !== "aus" && vault !== "col") {
    return { ok: false, error: "Say which vault." };
  }

  const reason = str(formData, "reason");
  if (kind === "withdrawal" && !reason) {
    return {
      ok: false,
      error: "A withdrawal needs a reason. It is the one movement nobody can explain later.",
    };
  }

  const input: VaultMovementInput = {
    kind,
    vault,
    amount,
    // Either one. Wise shows the rate and the pesos; whichever he types, the
    // other is worked out rather than asked for twice.
    rate: money(formData, "rate"),
    amount_cop: money(formData, "amount_cop"),
    occurred_on: str(formData, "occurred_on") ?? todayInSydney(),
    reason,
    note: str(formData, "note"),
    recorded_by: null,
  };

  try {
    const { org, member } = await awesome();
    await recordVaultMovement(org.id, {
      ...input,
      recorded_by: signatureFor(member),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }

  revalidatePath("/savings/vault");
  revalidatePath("/savings/overview");
  return { ok: true };
}

export async function deleteVaultMovementAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = str(formData, "id");
  if (!id) return { ok: false, error: "Missing movement id." };
  try {
    const { org } = await awesome();
    await deleteVaultMovement(org.id, id);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
  revalidatePath("/savings/vault");
  revalidatePath("/savings/overview");
  return { ok: true };
}
