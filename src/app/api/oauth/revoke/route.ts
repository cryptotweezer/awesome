import type { NextRequest } from "next/server";
import { revokeByToken } from "@/lib/oauth/credentials";
import { protectAuth } from "@/lib/security/arcjet";

/**
 * Token revocation (RFC 7009). An assistant being disconnected on the user's
 * machine should be able to hand its token back rather than leave a live
 * connection behind.
 *
 * Always answers 200, even for a token we have never seen. That is what the
 * spec asks for, and it stops this endpoint from becoming a way to test
 * whether a token exists.
 */
export async function POST(request: NextRequest) {
  // Revoking is the safe direction, but it is still an unauthenticated door
  // that touches the database on every call. Inert with no ARCJET_KEY.
  const guard = await protectAuth(request);
  if (!guard.ok) {
    return new Response(null, { status: 429 });
  }

  const token = await readToken(request);
  if (token) await revokeByToken(token);
  return new Response(null, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}

async function readToken(request: NextRequest): Promise<string | null> {
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const body = (await request.json()) as Record<string, unknown>;
      return typeof body.token === "string" ? body.token : null;
    }
    const form = await request.formData();
    const value = form.get("token");
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}
