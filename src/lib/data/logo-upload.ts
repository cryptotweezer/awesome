import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { LOGO_BUCKET } from "@/lib/pdf/logo";

/**
 * Putting a business's logo into object storage, from either door: the form
 * that creates the business, and Business details afterwards.
 *
 * The path is derived from the organisation id and never from the file name,
 * so one business can neither overwrite another's logo nor escape its own
 * folder with a crafted name. Type and size are checked here and again by the
 * bucket itself.
 */

const MAX_LOGO_BYTES = 1_048_576; // 1 MB, matching the bucket's own limit

const LOGO_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
};

export type LogoResult = { path: string } | { error: string };

export async function storeOrgLogo(
  orgId: string,
  file: File,
): Promise<LogoResult> {
  const ext = LOGO_TYPES[file.type];
  if (!ext) return { error: "The logo must be a PNG or a JPEG." };
  if (file.size > MAX_LOGO_BYTES) {
    return { error: "The logo must be smaller than 1 MB." };
  }

  const supabase = createAdminClient();
  const path = `${orgId}/logo.${ext}`;
  const { error } = await supabase.storage
    .from(LOGO_BUCKET)
    .upload(path, await file.arrayBuffer(), {
      contentType: file.type,
      upsert: true,
    });
  if (error) return { error: `Upload failed: ${error.message}` };

  // Switching format leaves the old file behind, so clear it out.
  const stale = ext === "png" ? `${orgId}/logo.jpg` : `${orgId}/logo.png`;
  await supabase.storage.from(LOGO_BUCKET).remove([stale]);

  return { path };
}
