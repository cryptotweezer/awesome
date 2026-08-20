import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "crypto";

/**
 * Credentials the gateway accepts. Two kinds, one storage rule: we keep only a
 * hash, so the table alone can never be replayed.
 *
 *   awsm_...   an API key. Minted on the Agent keys page, shown once, pasted
 *              into an assistant's config. This is what headless agents use:
 *              a VPS has no browser and can never complete an OAuth flow.
 *   awso_...   an OAuth access or refresh token, issued by our own
 *              authorization server after somebody approved a consent screen.
 *
 * The prefix is what lets `authenticateAgent` route a credential to the right
 * validator without guessing, which is the whole reason both can share one
 * Authorization header.
 */

export const KEY_PREFIX = "awsm_";
export const TOKEN_PREFIX = "awso_";

/**
 * An optional server-side pepper (AGENT_KEY_PEPPER) means a leaked table can't
 * be used to forge a credential without also knowing the deployment's config.
 * The hash stays deterministic because we look credentials up by it, which
 * rules out a per-row salt. A slow password hash would buy nothing here: the
 * input is 24 random bytes, not something a person chose.
 */
export function hashKey(raw: string): string {
  const pepper = process.env.AGENT_KEY_PEPPER ?? "";
  return createHash("sha256").update(pepper + raw).digest("hex");
}

/** Mint a fresh raw API key. */
export function generateKey(): string {
  return `${KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
}

/** Mint a fresh raw OAuth token (access or refresh). */
export function generateToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** Compare two secrets without leaking their difference through timing. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
