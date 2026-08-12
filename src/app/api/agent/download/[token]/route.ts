import { verifyDownloadToken } from "@/lib/gateway/download";
import { renderDoc } from "@/lib/gateway/documents";

/**
 * The other end of a document link handed out by the gateway.
 *
 * There is no Authorization header here on purpose: the person clicking has a
 * browser, not an agent key, and an agent that saves the file to disk should
 * not have to re-send its key to a URL that already says what it is for. The
 * token IS the credential. It is signed, it carries the organisation and the
 * document, and it expires, so a stale link in a chat log is worth nothing.
 *
 * Nothing is stored: this renders the document again, from live data, the same
 * way the dashboard does. A link fetched twice can therefore differ, which is
 * correct, an invoice marked paid in between should come back saying so.
 *
 *   GET /api/agent/download/<token>            -> downloads the file
 *   GET /api/agent/download/<token>?inline=1   -> opens in the PDF viewer
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/agent/download/[token]">,
) {
  const { token } = await ctx.params;
  const verified = verifyDownloadToken(token);
  if (!verified) {
    return new Response("This download link is not valid, or has expired.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  let doc;
  try {
    doc = await renderDoc(verified.orgId, verified.doc);
  } catch {
    return new Response("That document is no longer available.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const inline = new URL(request.url).searchParams.get("inline") === "1";
  return new Response(new Uint8Array(doc.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${doc.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
