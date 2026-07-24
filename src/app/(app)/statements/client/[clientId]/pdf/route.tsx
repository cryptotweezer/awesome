import { renderToBuffer } from "@react-pdf/renderer";
import { getClientStatement } from "@/lib/data/statements";
import { getCompanyProfile } from "@/lib/data/company";
import { ClientStatementDocument } from "@/lib/pdf/client-statement-pdf";

/**
 * Payment-reminder statement for one client — every invoice they still owe,
 * whichever ABN issued it. Rendered on demand, never stored. Same URL serves
 * the dashboard button and Hermes/Ema.
 *
 *   GET /statements/client/:clientId/pdf            -> downloads the file
 *   GET /statements/client/:clientId/pdf?inline=1   -> renders in the browser
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/statements/client/[clientId]/pdf">,
) {
  const { clientId } = await ctx.params;

  const [statement, company] = await Promise.all([
    getClientStatement(clientId),
    getCompanyProfile(),
  ]);
  if (!statement) {
    return new Response("Nothing outstanding for this client", { status: 404 });
  }

  const buffer = await renderToBuffer(
    <ClientStatementDocument statement={statement} company={company} />,
  );

  const slug = statement.client.name
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "");
  const filename = `Statement-${slug}-${statement.statementDate}.pdf`;
  const inline = new URL(request.url).searchParams.get("inline") === "1";

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
