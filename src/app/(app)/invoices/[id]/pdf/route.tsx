import { renderToBuffer } from "@react-pdf/renderer";
import { getInvoice } from "@/lib/data/invoices";
import { getCompanyProfile } from "@/lib/data/company";
import { InvoiceDocument } from "@/lib/pdf/invoice-pdf";

/**
 * Renders the invoice as a PDF on demand and streams it back. Nothing is
 * stored — not in the DB, not on disk. The same URL serves the dashboard's
 * "PDF" button and (later) Hermes/Ema, which fetches the bytes and forwards
 * them over Telegram/email.
 *
 *   GET /invoices/:id/pdf            -> downloads the file
 *   GET /invoices/:id/pdf?inline=1   -> renders in the browser's PDF viewer
 *
 * Access is enforced by the proxy (session cookie, or the Hermes API key).
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/invoices/[id]/pdf">,
) {
  const { id } = await ctx.params;

  const [invoice, company] = await Promise.all([
    getInvoice(id),
    getCompanyProfile(),
  ]);
  if (!invoice) {
    return new Response("Invoice not found", { status: 404 });
  }

  const buffer = await renderToBuffer(
    <InvoiceDocument invoice={invoice} company={company} />,
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
