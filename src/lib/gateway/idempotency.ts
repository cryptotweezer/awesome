import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * A retry that cannot bill somebody twice.
 *
 * An agent whose request times out has no way to know whether the invoice was
 * raised. It retries, because that is the right thing for it to do, and without
 * this the client gets two invoices for the same work. So every create takes an
 * optional key the caller can reproduce: the first call stores its answer under
 * that key, and a second call with the same key is handed the SAME record back
 * rather than making another.
 *
 * Kept deliberately small: it applies only to the tools that create something,
 * because setting a value twice lands in the same place but creating twice does
 * not. Entries expire after a day (`purge_agent_history`), which is far longer
 * than any retry and short enough that this never becomes a table anyone has to
 * think about.
 */

/** What was answered the first time, or null if this key is new here. */
export async function recallWrite(
  orgId: string,
  tool: string,
  key: string,
): Promise<unknown | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("agent_writes")
    .select("result")
    .eq("org_id", orgId)
    .eq("tool", tool)
    .eq("idempotency_key", key)
    .maybeSingle();
  // A lookup that fails must not stop the work: the worst case is that the
  // create runs, which is what would have happened without this at all.
  if (error) {
    console.error("agent_writes lookup failed:", error.message);
    return null;
  }
  return data ? (data.result ?? null) : null;
}

/**
 * Remember what this key answered. `ignoreDuplicates` matters: two retries can
 * land at once, and the second one losing the race is not an error worth
 * showing anybody.
 */
export async function rememberWrite(
  orgId: string,
  tool: string,
  key: string,
  result: unknown,
): Promise<void> {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("agent_writes")
      .upsert(
        {
          org_id: orgId,
          tool,
          idempotency_key: key,
          result: result ?? { ok: true },
        },
        { onConflict: "org_id,tool,idempotency_key", ignoreDuplicates: true },
      );
    if (error) console.error("agent_writes insert failed:", error.message);
  } catch (e) {
    console.error("agent_writes insert threw:", e);
  }
}

/** The key a caller sent, if it sent one. Any reproducible string will do. */
export function idempotencyKeyOf(input: Record<string, unknown>): string | null {
  const raw = input.idempotency_key ?? input.idempotencyKey;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed.slice(0, 200) : null;
}
