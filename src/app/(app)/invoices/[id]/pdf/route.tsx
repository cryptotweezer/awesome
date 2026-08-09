import { renderToBuffer } from "@react-pdf/renderer";
import { getInvoiceByRef } from "@/lib/data/invoices";
import { getCompanyProfile } from "@/lib/data/company";
import { getCurrentOrg } from "@/lib/data/org";
import { InvoiceDocument } from "@/lib/pdf/invoice-pdf";
import { loadLogo } from "@/lib/pdf/logo";

/**
 * Renders the invoice as a PDF on demand and streams it back. Nothing is
 * stored — not in the DB, not on disk. The same URL serves the dashboard's
 * "PDF" button and (later) Hermes/Ema, which fetches the bytes and forwards
 * them over Telegram/email.
 *
 * The path segment accepts either the invoice UUID or its invoice_number, so
 * "/invoices/1954/pdf" works as well as the UUID form.
 *
 *   GET /invoices/:ref/pdf            -> downloads the file
 *   GET /invoices/:ref/pdf?inline=1   -> renders in the browser's PDF viewer
 *
 * The proxy checks that there IS a session; ownership is checked here, because
 * a signed-in stranger asking for /invoices/1945/pdf must get a 404 rather than
 * somebody else's invoice.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/invoices/[id]/pdf">,
) {
  const { id } = await ctx.params;

  const session = await getCurrentOrg();
  if (!session) return new Response("Invoice not found", { status: 404 });

  const [invoice, company] = await Promise.all([
    getInvoiceByRef(session.org.id, id),
    getCompanyProfile(session.org.id),
  ]);
  if (!invoice) {
    return new Response("Invoice not found", { status: 404 });
  }

  const buffer = await renderToBuffer(
    <InvoiceDocument
      invoice={invoice}
      company={company}
      logo={await loadLogo(session.org)}
      taxIdLabel={session.org.tax_id_label}
    />,
  );

  const slug = invoice.bill_to_name
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "");
  const filename = `Invoice-${invoice.invoice_number}-${slug}.pdf`;
  const inline = new URL(request.url).searchParams.get("inline") === "1";

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
