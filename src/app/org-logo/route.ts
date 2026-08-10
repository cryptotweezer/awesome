import { NextResponse } from "next/server";
import { getCurrentOrg } from "@/lib/data/org";
import { createAdminClient } from "@/lib/supabase/admin";
import { LOGO_BUCKET } from "@/lib/pdf/logo";

/**
 * The signed-in business's own logo, as an image.
 *
 *   GET /org-logo
 *
 * Logos live in a private bucket, so there is no URL a browser can load on its
 * own. This is the one way in, and it takes no parameters on purpose: the only
 * logo it will ever serve is the one belonging to the session asking, so no
 * amount of guessing reaches another business's file.
 *
 * A business with no logo gets a 404 rather than a placeholder. The built-in
 * mark in `public/` belongs to the business that owns this deployment, and
 * lending it to a stranger's dashboard would be handing them somebody else's
 * identity, the same rule the printed documents follow.
 */
export async function GET() {
  const ctx = await getCurrentOrg();
  if (!ctx?.org.logo_path) {
    return new NextResponse(null, { status: 404 });
  }

  const { data, error } = await createAdminClient()
    .storage.from(LOGO_BUCKET)
    .download(ctx.org.logo_path);
  if (error || !data) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(await data.arrayBuffer(), {
    headers: {
      "Content-Type": ctx.org.logo_path.toLowerCase().endsWith(".png")
        ? "image/png"
        : "image/jpeg",
      // Private: this is one business's file behind one session's cookie, and
      // it must never be held by a shared cache. Short, so a new logo shows up
      // straight away rather than after a reload that looks broken.
      "Cache-Control": "private, max-age=30, must-revalidate",
    },
  });
}
