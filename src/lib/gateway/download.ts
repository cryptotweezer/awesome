import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Short-lived download links for the documents an agent asks for.
 *
 * A PDF used to come back only as base64, which is a single 60,000 character
 * line. Real assistants refuse a tool result that size: Claude Code writes it
 * to a temp file and hands the agent a path instead, and anything with a
 * smaller budget simply drops it. The bytes were there and the person still
 * could not get their invoice.
 *
 * So the tools answer with a link. The link carries its own credential (this
 * token) because the browser that opens it has no agent key, and it expires,
 * because a document address that lives forever is a document that leaked.
 * Nothing is stored: following the link renders the PDF again from live data,
 * exactly as the dashboard does.
 */

/** How long a link stays good. Long enough to click, short enough to forget. */
export const DOWNLOAD_TTL_SECONDS = 30 * 60;

export type DocRef =
  | { kind: "invoice"; ref: string }
  | { kind: "client_statement"; ref: string }
  | { kind: "tax_statement"; ref: string; fyStart?: string | null }
  /** The whole business as a file. `ref` is the format: "excel" or "json". */
  | { kind: "backup"; ref: "excel" | "json" };

type Payload = {
  /** Organisation. The link can only ever produce this business's document. */
  o: string;
  k: DocRef["kind"];
  r: string;
  /** Second reference, only the FY start so far. */
  s?: string;
  /** Expiry, epoch seconds. */
  x: number;
};

/**
 * The signing secret. `AGENT_KEY_PEPPER` is the app's existing server secret;
 * the service_role key is the fallback so a self-hosted copy signs with
 * something unguessable without having to configure anything. Both are
 * server-only and neither is ever sent anywhere.
 */
function secret(): string {
  const s =
    process.env.AGENT_KEY_PEPPER?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!s) throw new Error("No secret available to sign download links");
  return `download:${s}`;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(body: string): string {
  return createHmac("sha256", secret()).update(body).digest("base64url");
}

export function signDownloadToken(
  orgId: string,
  doc: DocRef,
  ttlSeconds = DOWNLOAD_TTL_SECONDS,
): { token: string; expiresAt: string } {
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload: Payload = {
    o: orgId,
    k: doc.kind,
    r: doc.ref,
    x: expiry,
    ...(doc.kind === "tax_statement" && doc.fyStart ? { s: doc.fyStart } : {}),
  };
  const body = b64url(JSON.stringify(payload));
  return {
    token: `${body}.${sign(body)}`,
    expiresAt: new Date(expiry * 1000).toISOString(),
  };
}

export type VerifiedDownload = {
  orgId: string;
  doc: DocRef;
};

/**
 * Check a token and say what it is for. Returns null for anything that is not
 * exactly a token this server signed and that has not run out of time, without
 * saying which of the two went wrong.
 */
export function verifyDownloadToken(token: string): VerifiedDownload | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = Buffer.from(sign(body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length) return null;
  if (!timingSafeEqual(expected, given)) return null;

  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload?.o || !payload.k || !payload.r || !payload.x) return null;
  if (payload.x < Math.floor(Date.now() / 1000)) return null;

  if (payload.k === "tax_statement") {
    return {
      orgId: payload.o,
      doc: { kind: "tax_statement", ref: payload.r, fyStart: payload.s ?? null },
    };
  }
  if (payload.k === "invoice" || payload.k === "client_statement") {
    return { orgId: payload.o, doc: { kind: payload.k, ref: payload.r } };
  }
  if (payload.k === "backup") {
    if (payload.r !== "excel" && payload.r !== "json") return null;
    return { orgId: payload.o, doc: { kind: "backup", ref: payload.r } };
  }
  return null;
}
