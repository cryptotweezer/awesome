import { renderToBuffer } from "@react-pdf/renderer";
import { getFyStatement } from "@/lib/data/statements";
import { getCompanyProfile } from "@/lib/data/company";
import { getCurrentOrg } from "@/lib/data/org";
import { financialYearStart } from "@/lib/data/invoices";
import { todayInTimezone } from "@/lib/format";
import { FyStatementDocument } from "@/lib/pdf/fy-statement-pdf";
import { loadLogo } from "@/lib/pdf/logo";

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

  // An issuer id from another business must read as "ABN not found".
  const session = await getCurrentOrg();
  if (!session) return new Response("ABN not found", { status: 404 });
  const { org } = session;

  const fy = params.get("fy");
  const startMonth = String(org.fy_start_month).padStart(2, "0");
  if (fy && !new RegExp(`^\\d{4}-${startMonth}-01$`).test(fy)) {
    return new Response(
      `fy must be a financial-year start (YYYY-${startMonth}-01)`,
      { status: 400 },
    );
  }
  const fyStart =
    fy ?? financialYearStart(todayInTimezone(org.timezone), org.fy_start_month);

  const [statement, company] = await Promise.all([
    getFyStatement(org, issuerId, fyStart),
    getCompanyProfile(org.id),
  ]);
  if (!statement) return new Response("ABN not found", { status: 404 });

  const buffer = await renderToBuffer(
    <FyStatementDocument
      statement={statement}
      company={company}
      logo={await loadLogo(org)}
      taxIdLabel={org.tax_id_label}
    />,
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
