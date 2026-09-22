"use server";

import { revalidatePath } from "next/cache";
import { setClientRotation } from "@/lib/data/clients";
import { AWESOME_ORG_ID, requireOrg } from "@/lib/data/org";

export type ActionState = { ok: boolean; error?: string };

/**
 * Place a client on a day of one rotation week, or take them out of it.
 *
 * `day` carries three meanings and they are all real:
 *   a number 1..7  the day they are done
 *   ""             in this week, day not decided yet
 *   "remove"       not in this week at all
 */
export async function setRotationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = (formData.get("client_id") as string | null)?.trim();
  if (!id) return { ok: false, error: "Missing client." };

  const week = Number(formData.get("week"));
  if (week !== 1 && week !== 2) return { ok: false, error: "Unknown week." };

  const raw = (formData.get("day") as string | null)?.trim() ?? "";
  const remove = raw === "remove";
  const day = raw === "" || remove ? null : Number(raw);
  if (day !== null && (!Number.isInteger(day) || day < 1 || day > 7)) {
    return { ok: false, error: "Unknown day." };
  }

  try {
    const { org } = await requireOrg();
    // A server action is a public endpoint: the gate cannot live in the page.
    if (org.id !== AWESOME_ORG_ID) throw new Error("Not available.");
    await setClientRotation(org.id, id, week, !remove, day);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }

  revalidatePath("/savings/rotation");
  return { ok: true };
}
