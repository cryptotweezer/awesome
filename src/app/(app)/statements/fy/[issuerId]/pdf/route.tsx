import { renderToBuffer } from "@react-pdf/renderer";
import { getFyStatement } from "@/lib/data/statements";
import { getCompanyProfile } from "@/lib/data/company";
import { financialYearStart } from "@/lib/data/invoices";
import { FyStatementDocument } from "@/lib/pdf/fy-statement-pdf";

/**
 * Financial-year statement for the accountant: all invoices one ABN issued in
 * an Australian financial year. Rendered on demand, never stored.
 *
 *   GET /statements/fy/:issuerId/pdf?fy=2026-07-01
 *   ...&inline=1   -> render in the browser instead of downloading
 *
 * `fy` is the FY start date (YYYY-07-01); it defaults to the current one.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/statements/fy/[issuerId]/pdf">,
) {
  const { issuerId } = await ctx.params;
  const params = new URL(request.url).searchParams;

  const fy = params.get("fy");
  if (fy && !/^\d{4}-07-01$/.test(fy)) {
    return new Response("fy must be a financial-year start (YYYY-07-01)", {
      status: 400,
    });
  }
  const fyStart = fy ?? financialYearStart();

  const [statement, company] = await Promise.all([
    getFyStatement(issuerId, fyStart),
    getCompanyProfile(),
  ]);
  if (!statement) return new Response("ABN not found", { status: 404 });

  const buffer = await renderToBuffer(
    <FyStatementDocument statement={statement} company={company} />,
  );

  const filename = `Invoices-${statement.fyLabel.replace(/\s/g, "-")}-${statement.issuer.short_name}.pdf`;
  const inline = params.get("inline") === "1";

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
