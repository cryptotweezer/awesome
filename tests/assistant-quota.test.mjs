// The assistant's message allowance.
//
//   node --env-file=.env.local --test tests/assistant-quota.test.mjs
//
// This runs on the deployment owner's AI credit, so the allowance is the thing
// standing between a trial account and somebody else's bill. It is spent in the
// database, before the model is called, so two tabs cannot both slip through on
// the same remaining message.
//
// The model call itself is not exercised here: it needs a real API key and
// would cost money to test. What is tested is everything that decides whether
// the call happens at all.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Run with: node --env-file=.env.local --test tests/assistant-quota.test.mjs");
  process.exit(1);
}

const db = createClient(url, key, {
  db: { schema: "awesome" },
  auth: { persistSession: false, autoRefreshToken: false },
});

const AWESOME_ORG_ID = "00000000-0000-0000-0000-000000000001";
const userId = randomUUID();
let orgId = null;

after(async () => {
  if (orgId) {
    await db.from("issuers").delete().eq("org_id", orgId);
    await db.from("org_members").delete().eq("org_id", orgId);
    await db.from("orgs").delete().eq("id", orgId);
  } else {
    await db.from("org_members").delete().eq("user_id", userId);
  }
});

describe("a trial account gets a fixed allowance", () => {
  test("a new business starts with its full allowance unspent", async () => {
    const { data, error } = await db.rpc("create_org", {
      p_user_id: userId,
      p_email: `quota-${userId.slice(0, 8)}@example.test`,
      p_display_name: "Quota Test",
      p_name: "Quota Test Business",
      p_issuer_name: "Quota Test Business",
      p_tax_id: `8${userId.replace(/\D/g, "").padEnd(10, "0").slice(0, 10)}`,
    });
    assert.equal(error, null, error?.message);
    orgId = data.id;
    assert.equal(data.max_ai_messages, 20);
    assert.equal(data.ai_messages_used, 0);
  });

  test("each message spent comes back off the total", async () => {
    for (let spent = 1; spent <= 3; spent++) {
      const { data, error } = await db.rpc("consume_ai_message", {
        p_org_id: orgId,
      });
      assert.equal(error, null, error?.message);
      assert.equal(data, 20 - spent, `after ${spent} messages`);
    }
  });

  test("the count is stored, not just returned", async () => {
    const { data } = await db
      .from("orgs")
      .select("ai_messages_used")
      .eq("id", orgId)
      .single();
    assert.equal(data.ai_messages_used, 3);
  });

  test("the allowance runs out and stays out", async () => {
    await db.from("orgs").update({ ai_messages_used: 20 }).eq("id", orgId);

    const first = await db.rpc("consume_ai_message", { p_org_id: orgId });
    assert.ok(first.error, "a 21st message was allowed");
    assert.match(first.error.message, /trial account/i);

    // And asking again does not quietly increment past the cap.
    const { data } = await db
      .from("orgs")
      .select("ai_messages_used")
      .eq("id", orgId)
      .single();
    assert.equal(data.ai_messages_used, 20);
  });

  test("concurrent requests cannot both spend the last message", async () => {
    await db.from("orgs").update({ ai_messages_used: 19 }).eq("id", orgId);

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        db.rpc("consume_ai_message", { p_org_id: orgId }),
      ),
    );
    const allowed = results.filter((r) => !r.error).length;
    assert.equal(allowed, 1, `${allowed} requests got through the last message`);

    const { data } = await db
      .from("orgs")
      .select("ai_messages_used")
      .eq("id", orgId)
      .single();
    assert.equal(data.ai_messages_used, 20, "the counter overran its cap");
  });
});

describe("the deployment owner has no allowance to run out of", () => {
  test("consume_ai_message returns null and counts nothing", async () => {
    const before = await db
      .from("orgs")
      .select("ai_messages_used")
      .eq("id", AWESOME_ORG_ID)
      .single();

    const { data, error } = await db.rpc("consume_ai_message", {
      p_org_id: AWESOME_ORG_ID,
    });
    assert.equal(error, null, error?.message);
    assert.equal(data, null, "an unlimited account reported a remaining count");

    const after_ = await db
      .from("orgs")
      .select("ai_messages_used")
      .eq("id", AWESOME_ORG_ID)
      .single();
    assert.equal(after_.data.ai_messages_used, before.data.ai_messages_used);
  });
});
