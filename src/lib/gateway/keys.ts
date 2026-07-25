import "server-only";
import { createHash, randomBytes } from "crypto";

/**
 * Gateway API keys. We store only a hash of the raw key; the raw value is shown
 * once at mint time and never persisted. An optional server-side pepper
 * (AGENT_KEY_PEPPER) means a leaked `agent_keys` table alone can't be used to
 * forge a key without also knowing the pepper.
 */

export function hashKey(raw: string): string {
  const pepper = process.env.AGENT_KEY_PEPPER ?? "";
  return createHash("sha256").update(pepper + raw).digest("hex");
}

/** Mint a fresh raw key. Prefix makes it recognisable in logs / config. */
export function generateKey(): string {
  return `awsm_${randomBytes(24).toString("base64url")}`;
}
