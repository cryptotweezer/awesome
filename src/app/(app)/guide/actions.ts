"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import JSZip from "jszip";
import { requireOrg, updateOrgOnboarding } from "@/lib/data/org";
import { mintAgentKey } from "@/lib/data/agent-keys";
import { listIssuers } from "@/lib/data/issuers";
import {
  buildSkillFiles,
  buildInstallPrompt,
  skillFolderName,
} from "@/lib/guest/skill";

export type KitState = {
  ok: boolean;
  error?: string;
  /** Present only in the response that minted the key. Shown once. */
  kit?: {
    filename: string;
    /** The zip, base64, handed to the browser to save. */
    zip_base64: string;
    prompt: string;
  };
};

/**
 * Where this deployment lives, from the request itself. Hardcoding it would
 * break the moment somebody runs their own copy, which is the whole point of
 * the kit this URL goes into.
 */
async function baseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Mint a key and build the install kit around it, in one step.
 *
 * It has to be one step: the raw key exists only in the request that creates
 * it, so this is the only moment a file or a prompt can be written with the key
 * already filled in. Ask for the kit twice and you get two keys.
 */
export async function createAgentKitAction(
  _prev: KitState,
  form: FormData,
): Promise<KitState> {
  const { org } = await requireOrg();
  const label =
    (form.get("label") as string | null)?.trim() || "My assistant";

  try {
    const [{ key }, issuers, url] = await Promise.all([
      mintAgentKey(org.id, label),
      listIssuers(org.id),
      baseUrl(),
    ]);

    const ctx = { org, issuer: issuers[0] ?? null, key, baseUrl: url };
    const zip = new JSZip();
    for (const [path, contents] of Object.entries(buildSkillFiles(ctx))) {
      zip.file(path, contents);
    }
    const buffer = await zip.generateAsync({ type: "nodebuffer" });

    await updateOrgOnboarding(org.id, { key_created: true });
    revalidatePath("/agent-keys");

    return {
      ok: true,
      kit: {
        filename: `${skillFolderName(org)}.zip`,
        zip_base64: buffer.toString("base64"),
        prompt: buildInstallPrompt(ctx),
      },
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not build the kit.",
    };
  }
}

/** Tick or untick one step of the setup checklist. */
export async function setStepAction(
  step: string,
  done: boolean,
): Promise<{ ok: boolean }> {
  const { org } = await requireOrg();
  await updateOrgOnboarding(org.id, { [step]: done });
  revalidatePath("/guide");
  return { ok: true };
}
