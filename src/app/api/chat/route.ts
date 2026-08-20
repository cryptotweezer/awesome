import { NextResponse } from "next/server";
import { ALL_SCOPES } from "@/lib/gateway/scopes";
import { getCurrentOrg, signatureFor } from "@/lib/data/org";
import { createAdminClient } from "@/lib/supabase/admin";
import { runAssistant, type ChatMessage } from "@/lib/chat/assistant";
import { protectAssistant } from "@/lib/security/arcjet";

/**
 * The dashboard assistant.
 *
 * Authenticated by the session, not by an agent key: the proxy has already
 * established there is a signed-in user, and the organisation comes from their
 * membership. A caller therefore cannot choose which business to act on.
 *
 * The message allowance is spent BEFORE the model is called, and spent in the
 * database rather than here, so two tabs cannot both slip through on the same
 * remaining message.
 */
export async function POST(request: Request) {
  const session = await getCurrentOrg();
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const { org, member } = session;

  // A ceiling on hammering, keyed on the business. The real limit is the
  // message allowance below, which is counted in the database.
  const guard = await protectAssistant(request, org.id);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: guard.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }

  const messages = (body as { messages?: unknown }).messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "Nothing to answer." }, { status: 400 });
  }

  // Keep the window short: this is a working assistant, not a diary, and a long
  // history is mostly cost.
  const history = messages.slice(-20).map((m) => ({
    role: (m as ChatMessage).role === "assistant" ? "assistant" : "user",
    content: String((m as ChatMessage).content ?? "").slice(0, 4000),
  })) as ChatMessage[];

  const db = createAdminClient();
  const { data: remaining, error: quotaError } = await db.rpc(
    "consume_ai_message",
    { p_org_id: org.id },
  );
  if (quotaError) {
    // The quota function raises with a message written for the person, so it
    // is shown as-is rather than swallowed into a generic error.
    return NextResponse.json({ error: quotaError.message }, { status: 429 });
  }

  try {
    const reply = await runAssistant(
      history,
      {
        agent: {
          id: `dashboard:${member.user_id}`,
          // Invoices created here are signed by the person, exactly as they
          // are when created through the form.
          label: signatureFor(member),
          orgId: org.id,
          // The person is signed in and looking at the dashboard, where they
          // can already do all of this by clicking. Scopes exist to restrain a
          // credential handed to somebody else's software, not the owner.
          scopes: ALL_SCOPES,
          via: "session",
        },
      },
      org,
      member,
    );

    return NextResponse.json({
      content: reply.content,
      used_tools: reply.usedTools,
      remaining,
    });
  } catch (e) {
    // The allowance is spent before the model is called, so a turn that never
    // produced an answer would otherwise cost a message. Give it back: the
    // person got nothing for it, and a bad afternoon should not eat a trial.
    const { data: given } = await db.rpc("refund_ai_message", {
      p_org_id: org.id,
    });
    // Worth a line in the server log: the message shown to the person is
    // deliberately vague, and this is the only place the real reason exists.
    console.error("[assistant]", e);
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "The assistant failed.",
        remaining: given ?? remaining,
      },
      { status: 502 },
    );
  }
}
