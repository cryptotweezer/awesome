import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createAdminClient } from "@/lib/supabase/admin";
import { AWESOME_ORG_ID } from "@/lib/data/org";
import type { Org } from "@/lib/types";

/**
 * The logo printed on one business's documents.
 *
 * The rule that matters: a business that has not uploaded a logo prints NO
 * logo. It must never inherit the one in `public/`, because that is the mark of
 * the business that owns this deployment, and putting it on a stranger's
 * invoice would be handing them somebody else's identity.
 *
 * The single exception is that business itself, which keeps a copy of its logo
 * in the repo so its invoices do not depend on object storage being reachable.
 */
/** react-pdf wants a Buffer here, not a Uint8Array. */
export type Logo = { data: Buffer; format: "png" | "jpg" };

export const LOGO_BUCKET = "org-logos";

let builtIn: Logo | null | undefined;

/**
 * `public/logo_black.png` is kept in the serverless trace by
 * `outputFileTracingIncludes` in next.config.ts, so this works on Vercel too.
 * Read once per server process.
 */
function builtInLogo(): Logo | null {
  if (builtIn !== undefined) return builtIn;
  try {
    builtIn = {
      data: readFileSync(path.join(process.cwd(), "public", "logo_black.png")),
      format: "png",
    };
  } catch {
    builtIn = null;
  }
  return builtIn;
}

export async function loadLogo(org: Org): Promise<Logo | null> {
  if (org.logo_path) {
    try {
      const { data, error } = await createAdminClient()
        .storage.from(LOGO_BUCKET)
        .download(org.logo_path);
      if (!error && data) {
        return {
          data: Buffer.from(await data.arrayBuffer()),
          format: org.logo_path.toLowerCase().endsWith(".png") ? "png" : "jpg",
        };
      }
    } catch {
      // Fall through: a document without a logo still beats no document.
    }
  }

  return org.id === AWESOME_ORG_ID ? builtInLogo() : null;
}
