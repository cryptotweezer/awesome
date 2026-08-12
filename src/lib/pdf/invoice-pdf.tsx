import "server-only";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { CompanyProfile, Invoice, InvoiceItem } from "@/lib/types";
import type { Logo } from "./logo";
import { formatDate } from "@/lib/format";
import {
  INK,
  MUTED,
  LINE,
  base,
  money,
  LetterHead,
  PaymentFooter,
  PageNumber,
  Meta,
} from "./shared";

/**
 * Printed invoice layout — mirrors the original spreadsheet invoice the
 * business already sends to clients. Rendered on demand and streamed to the
 * caller; a PDF is NEVER stored (neither in the DB nor on disk).
 */

const s = StyleSheet.create({
  midRow: { flexDirection: "row", justifyContent: "space-between", gap: 24 },

  table: { marginTop: 22 },
  th: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: INK,
    paddingBottom: 5,
  },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: LINE,
    paddingVertical: 7,
  },
  thText: { fontFamily: "Helvetica-Bold", fontSize: 9 },
  colDesc: { flex: 1 },
  colQty: { width: 58, textAlign: "right" },
  colRate: { width: 76, textAlign: "right" },
  colAmount: { width: 82, textAlign: "right" },
  serviceDate: { color: MUTED, fontSize: 8.5, marginTop: 2 },

  totals: { marginTop: 14, flexDirection: "row", justifyContent: "flex-end" },
  totalsBox: { width: 216 },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
  },
  balanceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 5,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: INK,
  },
  balanceText: { fontFamily: "Helvetica-Bold", fontSize: 12 },

  stamp: {
    marginTop: 20,
    padding: 8,
    borderWidth: 1,
    fontFamily: "Helvetica-Bold",
    textAlign: "center",
    fontSize: 12,
  },
  stampCancelled: { borderColor: "#b91c1c", color: "#b91c1c" },
  stampPaid: { borderColor: "#15803d", color: "#15803d" },

  // Only printed by businesses registered for GST. The ATO wants the words
  // "tax invoice" on the document itself, not only in the file name.
  taxInvoice: {
    marginTop: 10,
    fontFamily: "Helvetica-Bold",
    fontSize: 13,
    letterSpacing: 1,
  },
});

export type InvoicePdfData = Invoice & { invoice_items: InvoiceItem[] };

export function InvoiceDocument({
  invoice,
  company,
  logo,
  taxIdLabel,
}: {
  invoice: InvoicePdfData;
  company: CompanyProfile;
  /** This business's own logo, or null if it has not uploaded one. */
  logo: Logo | null;
  taxIdLabel?: string;
}) {
  const billTo = [
    invoice.bill_to_address_line,
    invoice.bill_to_suburb,
    [invoice.bill_to_state, invoice.bill_to_postcode].filter(Boolean).join(" "),
  ].filter((l): l is string => Boolean(l && l.trim()));

  const items = [...invoice.invoice_items].sort(
    (a, b) => a.sort_order - b.sort_order,
  );

  // The invoice's own frozen answer, not the business's current registration:
  // reprinting an old invoice must show what was charged at the time.
  const gst = Number(invoice.gst_amount ?? 0);
  const withGst = gst > 0;

  return (
    <Document
      title={`${withGst ? "Tax invoice" : "Invoice"} ${invoice.invoice_number} for ${invoice.bill_to_name}`}
      author={company.business_name}
    >
      <Page size="A4" style={base.page}>
        <LetterHead
          issuerName={invoice.issuer_name}
          issuerAbn={invoice.issuer_abn}
          issuerAcn={invoice.issuer_acn}
          company={company}
          logo={logo}
          taxIdLabel={taxIdLabel}
        />

        {withGst && <Text style={s.taxInvoice}>TAX INVOICE</Text>}

        <View style={s.midRow}>
          <View>
            <Text style={base.label}>Bill To:</Text>
            <Text style={base.billToName}>{invoice.bill_to_name}</Text>
            {billTo.map((line, i) => (
              <Text key={i} style={base.billToLine}>
                {line}
              </Text>
            ))}
          </View>

          <View>
            <Meta label="Invoice No:" value={String(invoice.invoice_number)} />
            <Meta label="Date:" value={formatDate(invoice.invoice_date)} />
            <Meta label="Terms:" value={invoice.terms} />
            <Meta label="Due Date:" value={formatDate(invoice.due_date)} />
          </View>
        </View>

        <View style={s.table}>
          <View style={s.th}>
            <Text style={[s.thText, s.colDesc]}>Description</Text>
            <Text style={[s.thText, s.colQty]}>Quantity</Text>
            <Text style={[s.thText, s.colRate]}>Rate</Text>
            <Text style={[s.thText, s.colAmount]}>Amount</Text>
          </View>

          {items.map((it) => (
            <View key={it.id} style={s.tr} wrap={false}>
              <View style={s.colDesc}>
                <Text>{it.description}</Text>
                {it.service_date && (
                  <Text style={s.serviceDate}>
                    {formatDate(it.service_date)}
                  </Text>
                )}
              </View>
              <Text style={s.colQty}>{Number(it.quantity)}</Text>
              <Text style={s.colRate}>{money(Number(it.rate))}</Text>
              <Text style={s.colAmount}>{money(Number(it.amount))}</Text>
            </View>
          ))}
        </View>

        <View style={s.totals}>
          <View style={s.totalsBox}>
            {/* Prices include GST, so the tax is shown inside the total rather
                than added to it: the client pays the same number either way. */}
            {withGst && (
              <>
                <View style={s.totalRow}>
                  <Text>Subtotal</Text>
                  <Text>{money(Number(invoice.total) - gst)}</Text>
                </View>
                <View style={s.totalRow}>
                  <Text>
                    GST ({(Number(invoice.gst_rate) * 100).toFixed(0)}%)
                  </Text>
                  <Text>{money(gst)}</Text>
                </View>
              </>
            )}
            <View style={s.totalRow}>
              <Text>Total</Text>
              <Text>{money(Number(invoice.total))}</Text>
            </View>
            <View style={s.totalRow}>
              <Text>Paid</Text>
              <Text>{money(Number(invoice.paid_amount))}</Text>
            </View>
            <View style={s.balanceRow}>
              <Text style={s.balanceText}>Balance Due</Text>
              <Text style={s.balanceText}>
                {money(Number(invoice.balance_due))}
              </Text>
            </View>
          </View>
        </View>

        {invoice.status === "cancelled" && (
          <Text style={[s.stamp, s.stampCancelled]}>CANCELLED</Text>
        )}
        {invoice.status === "paid" && (
          <Text style={[s.stamp, s.stampPaid]}>PAID</Text>
        )}

        <PaymentFooter company={company} />
        <PageNumber />
      </Page>
    </Document>
  );
}
