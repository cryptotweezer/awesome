// Put a logo in object storage and point a business at it.
//
//   node --env-file=.env.local scripts/upload-logo.mjs <file> [orgId]
//
// Defaults to public/logo_black.png and the Awesome organisation, which is how
// the original business gets its logo out of the repo and onto the same code
// path every other business uses. The repo copy stays as a fallback for that
// one organisation only: see src/lib/pdf/logo.ts.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Run with: node --env-file=.env.local scripts/upload-logo.mjs");
  process.exit(1);
}

const AWESOME_ORG_ID = "00000000-0000-0000-0000-000000000001";
const BUCKET = "org-logos";

const file = process.argv[2] ?? path.join("public", "logo_black.png");
const orgId = process.argv[3] ?? AWESOME_ORG_ID;
const ext = path.extname(file).toLowerCase() === ".png" ? "png" : "jpg";
const contentType = ext === "png" ? "image/png" : "image/jpeg";

const db = createClient(url, key, {
  db: { schema: "awesome" },
  auth: { persistSession: false, autoRefreshToken: false },
});

const bytes = readFileSync(file);
const target = `${orgId}/logo.${ext}`;

const { error: upErr } = await db.storage
  .from(BUCKET)
  .upload(target, bytes, { contentType, upsert: true });
if (upErr) {
  console.error(`Upload failed: ${upErr.message}`);
  process.exit(1);
}

const { error: dbErr } = await db
  .from("orgs")
  .update({ logo_path: target })
  .eq("id", orgId);
if (dbErr) {
  console.error(`Could not point the organisation at it: ${dbErr.message}`);
  process.exit(1);
}

console.log(`${file} -> ${BUCKET}/${target} (${bytes.length} bytes)`);
