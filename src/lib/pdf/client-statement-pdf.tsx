import "server-only";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { CompanyProfile } from "@/lib/types";
import type { Logo } from "./logo";
import type { ClientStatement } from "@/lib/data/statements";
import { formatDate } from "@/lib/format";
import {
  INK,
  MUTED,
  LINE,
  base,
  money,
  CompanyLetterHead,
  PaymentFooter,
  PageNumber,
  Meta,
} from "./shared";

/**
 * Payment-reminder statement: every outstanding invoice a client holds, across
 * both ABNs (this is a reminder, not a tax document). One row per service.
 * Generated on demand, never stored.
 */

/**
 * An invoice with more services than this is allowed to split across a page
 * break; anything smaller is kept whole, so the rows that carry a blank
 * invoice number always sit under the row that shows it.
 */
const MAX_ROWS_KEPT_TOGETHER = 12;

const s = StyleSheet.create({
  midRow: { flexDirection: "row", justifyContent: "space-between", gap: 24 },
  title: { fontFamily: "Helvetica-Bold", fontSize: 13, marginBottom: 6 },
  intro: { color: MUTED, marginTop: 14 },

  table: { marginTop: 16 },
  th: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: INK,
    paddingBottom: 5,
  },
  tr: { flexDirection: "row", paddingVertical: 6 },
  /** Rule where a new invoice starts, so its services read as one block. */
  group: { borderTopWidth: 0.5, borderTopColor: LINE },
  thText: { fontFamily: "Helvetica-Bold", fontSize: 9 },

  colInv: { width: 40 },
  colDate: { width: 60 },
  colDue: { width: 60 },
  colService: { width: 60 },
  colDesc: { flex: 1, paddingRight: 8 },
  colQty: { width: 26, textAlign: "right" },
  colAmount: { width: 64, textAlign: "right" },

  muted: { color: MUTED },

  totalRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: INK,
  },
  totalLabel: { marginRight: 16 },
  totalValue: { width: 90, textAlign: "right" },
});

export function ClientStatementDocument({
  statement,
  company,
  logo,
}: {
  statement: ClientStatement;
  company: CompanyProfile;
  logo: Logo | null;
}) {
  const { client } = statement;
  const billTo = [
    client.address_line,
    client.suburb,
    [client.state, client.postcode].filter(Boolean).join(" "),
  ].filter((l): l is string => Boolean(l && l.trim()));

  return (
    <Document
      title={`Statement for ${client.name}`}
      author={company.business_name}
    >
      <Page size="A4" style={base.page}>
        <CompanyLetterHead company={company} logo={logo} />

        <View style={s.midRow}>
          <View>
            <Text style={base.label}>Statement For:</Text>
            <Text style={base.billToName}>{client.name}</Text>
            {billTo.map((line, i) => (
              <Text key={i} style={base.billToLine}>
                {line}
              </Text>
            ))}
          </View>

          <View>
            <Text style={s.title}>Statement of Account</Text>
            <Meta
              label="Statement date:"
              value={formatDate(statement.statementDate)}
            />
            <Meta
              label="Invoices due:"
              value={String(statement.invoiceCount)}
            />
            <Meta label="Total due:" value={money(statement.total)} />
          </View>
        </View>

        <Text style={s.intro}>
          The invoices below were unpaid as at{" "}
          {formatDate(statement.statementDate)}.
        </Text>

        <View style={s.table}>
          <View style={s.th} fixed>
            <Text style={[s.thText, s.colInv]}>Inv</Text>
            <Text style={[s.thText, s.colDate]}>Invoice date</Text>
            <Text style={[s.thText, s.colDue]}>Due date</Text>
            <Text style={[s.thText, s.colService]}>Service date</Text>
            <Text style={[s.thText, s.colDesc]}>Description</Text>
            <Text style={[s.thText, s.colQty]}>Qty</Text>
            <Text style={[s.thText, s.colAmount]}>Amount</Text>
          </View>

          {statement.invoices.map((inv, invIndex) => (
            <View
              key={inv.invoice_id}
              style={invIndex > 0 ? s.group : undefined}
              wrap={inv.rows.length > MAX_ROWS_KEPT_TOGETHER}
            >
              {inv.rows.map((r, i) => (
                <View key={`${r.invoice_id}-${i}`} style={s.tr} wrap={false}>
                  {/* Only the first service carries the invoice number, so the
                      extra services don't read as separate invoices. */}
                  <Text style={s.colInv}>
                    {i === 0 ? r.invoice_number : ""}
                  </Text>
                  <Text style={[s.colDate, s.muted]}>
                    {i === 0 ? formatDate(r.invoice_date) : ""}
                  </Text>
                  <Text style={[s.colDue, s.muted]}>
                    {i === 0 ? formatDate(r.due_date) : ""}
                  </Text>
                  <Text style={[s.colService, s.muted]}>
                    {formatDate(r.service_date)}
                  </Text>
                  <Text style={s.colDesc}>{r.description}</Text>
                  <Text style={s.colQty}>{r.quantity}</Text>
                  <Text style={s.colAmount}>{money(r.amount)}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>

        <View style={s.totalRow}>
          <Text style={s.totalLabel}>TOTAL OUTSTANDING</Text>
          <Text style={s.totalValue}>{money(statement.total)}</Text>
        </View>

        <PaymentFooter company={company} />
        <PageNumber />
      </Page>
    </Document>
  );
}
