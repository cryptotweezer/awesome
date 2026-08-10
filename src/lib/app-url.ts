import "server-only";
import { headers } from "next/headers";

/**
 * Where this deployment lives, written as somebody else's computer has to type
 * it.
 *
 * The request's own host is right almost always, and wrong exactly when it
 * matters most: opening the dashboard on localhost while the app agents connect
 * to is at awesome.andreshenao.com.au produces a kit that tells an assistant to
 * call `http://localhost:3000`, which on that assistant's machine means itself.
 *
 * So APP_URL wins when it is set, and the request is the fallback. The fallback
 * is what keeps this honest for anyone running their own copy, who has no
 * reason to configure anything.
 */
export async function appBaseUrl(): Promise<string> {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
