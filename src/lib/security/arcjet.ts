import "server-only";
import arcjet, { shield, fixedWindow, type ArcjetDecision } from "@arcjet/next";

/**
 * Abuse protection for the endpoints anyone on the internet can reach.
 *
 * Three deliberate choices:
 *
 * 1. **No bot detection on the gateway.** Its callers are literally bots: that
 *    is the product. Blocking automated clients there would block the feature.
 *    What the gateway needs is a ceiling on volume and protection from attack
 *    patterns, not a judgement about who is human.
 * 2. **Rate limited per agent key, not per IP.** Several agents can share an
 *    office IP, and one agent can move between them. The key is the thing that
 *    identifies the caller, so it is the thing that gets the budget.
 * 3. **Inert without a key.** Somebody running their own copy of this app
 *    should not have to sign up to a third party to make it start. With no
 *    ARCJET_KEY every request is simply allowed.
 */

const key = process.env.ARCJET_KEY;

/**
 * Limits are generous on purpose. They exist to stop a runaway loop or a flood,
 * not to ration normal use: an agent working through a month of invoices makes
 * a lot of calls in a short time, and that is exactly what it is for.
 */
const gateway = key
  ? arcjet({
      key,
      characteristics: ["caller"],
      rules: [
        shield({ mode: "LIVE" }),
        fixedWindow({ mode: "LIVE", window: "60s", max: 300 }),
      ],
    })
  : null;

/**
 * The assistant is far more expensive per request, since each one can become
 * several model calls, so its ceiling is much lower. The message allowance in
 * the database is the real limit; this only catches something hammering it.
 */
const assistant = key
  ? arcjet({
      key,
      characteristics: ["caller"],
      rules: [
        shield({ mode: "LIVE" }),
        fixedWindow({ mode: "LIVE", window: "60s", max: 20 }),
      ],
    })
  : null;

/** Sign-in, where the caller is a browser and the identifier is the IP. */
const auth = key
  ? arcjet({
      key,
      rules: [
        shield({ mode: "LIVE" }),
        fixedWindow({ mode: "LIVE", window: "60s", max: 30 }),
      ],
    })
  : null;

export type Protection = { ok: true } | { ok: false; reason: string; status: number };

const ALLOWED: Protection = { ok: true };

function verdict(decision: ArcjetDecision): Protection {
  if (!decision.isDenied()) return ALLOWED;
  if (decision.reason.isRateLimit()) {
    return {
      ok: false,
      status: 429,
      reason: "Too many requests in a short time. Wait a minute and try again.",
    };
  }
  return { ok: false, status: 403, reason: "Request refused." };
}

/**
 * Protect a gateway request. `caller` is the agent key's id, so one agent's
 * runaway loop cannot spend another agent's budget.
 */
export async function protectGateway(
  request: Request,
  caller: string,
): Promise<Protection> {
  if (!gateway) return ALLOWED;
  try {
    return verdict(await gateway.protect(request, { caller }));
  } catch {
    // Arcjet being unreachable must not take billing down with it.
    return ALLOWED;
  }
}

/** Protect an assistant request. `caller` is the organisation id. */
export async function protectAssistant(
  request: Request,
  caller: string,
): Promise<Protection> {
  if (!assistant) return ALLOWED;
  try {
    return verdict(await assistant.protect(request, { caller }));
  } catch {
    return ALLOWED;
  }
}

/** Protect the OAuth callback, where all we know is the address it came from. */
export async function protectAuth(request: Request): Promise<Protection> {
  if (!auth) return ALLOWED;
  try {
    return verdict(await auth.protect(request));
  } catch {
    return ALLOWED;
  }
}
