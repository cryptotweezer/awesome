import "server-only";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { CompanyProfile } from "@/lib/types";
import type { Logo } from "./logo";
import type { FyStatement } from "@/lib/data/statements";
import { formatDate } from "@/lib/format";
import { deductionLabel } from "@/lib/savings";
import {
  INK,
  MUTED,
  LINE,
  base,
  money,
  LetterHead,
  PageNumber,
  Meta,
} from "./shared";

/**
 * Financial-year statement for the accountant: every invoice ONE ABN issued
 * inside an Australian financial year. Cancelled invoices are listed so a gap
 * in the numbering is explained, but they never reach the total. Internal notes
 * are deliberately absent — they are never printed. Runs to as many pages as
 * needed, in a single PDF.
 */

const s = StyleSheet.create({
  page: { ...base.page, fontSize: 8.5, paddingBottom: 46 },
  midRow: { flexDirection: "row", justifyContent: "space-between", gap: 24 },
  title: { fontFamily: "Helvetica-Bold", fontSize: 13, marginBottom: 6 },
  period: { color: MUTED, marginTop: 2 },

  table: { marginTop: 20 },
  th: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: INK,
    paddingBottom: 4,
  },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: LINE,
    paddingVertical: 5,
  },
  thText: { fontFamily: "Helvetica-Bold", fontSize: 8.5 },

  colNo: { width: 32 },
  colClient: { flex: 1, paddingRight: 6 },
  colSuburb: { width: 62, paddingRight: 4 },
  colInvDate: { width: 58 },
  colService: { width: 72 },
  colDue: { width: 58 },
  colTotal: { width: 56, textAlign: "right" },
  colStatus: { width: 46, textAlign: "right" },

  muted: { color: MUTED },
  cancelled: { color: MUTED, fontFamily: "Helvetica-Oblique" },

  totalRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: INK,
  },
  totalLabel: { fontFamily: "Helvetica-Bold", marginRight: 16 },
  totalValue: { fontFamily: "Helvetica-Bold", width: 80, textAlign: "right" },
  note: { marginTop: 8, fontSize: 8, color: MUTED },

  // The claims, when there are any. Same table, narrower: a day, what it was,
  // its kind and the amount.
  sectionTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
    marginTop: 26,
  },
  colDay: { width: 58 },
  colWhat: { flex: 1, paddingRight: 6 },
  colKind: { width: 92 },
});

export function FyStatementDocument({
  statement,
  company,
  logo,
  taxIdLabel,
}: {
  statement: FyStatement;
  company: CompanyProfile;
  logo: Logo | null;
  taxIdLabel?: string;
}) {
  const { issuer } = statement;

  return (
    <Document
      title={`Invoices ${statement.fyLabel} (${issuer.short_name})`}
      author={company.business_name}
    >
      <Page size="A4" style={s.page}>
        <LetterHead
          issuerName={issuer.full_name}
          issuerAbn={issuer.abn}
          company={company}
          logo={logo}
          taxIdLabel={taxIdLabel}
        />

        <View style={s.midRow}>
          <View>
            <Text style={s.title}>Invoices issued in {statement.fyLabel}</Text>
            <Text style={s.period}>
              Australian financial year: {formatDate(statement.fyStart)} to{" "}
              {formatDate(statement.fyEnd)}
            </Text>
            <Text style={s.period}>
              Issued under ABN {issuer.abn} ({issuer.short_name})
            </Text>
          </View>

          <View>
            <Meta label="Prepared:" value={formatDate(statement.generatedOn)} />
            <Meta label="Invoices:" value={String(statement.invoiceCount)} />
            {statement.cancelledCount > 0 && (
              <Meta
                label="Cancelled:"
                value={String(statement.cancelledCount)}
              />
            )}
            <Meta label="Total billed:" value={money(statement.total)} />
          </View>
        </View>

        <View style={s.table}>
          <View style={s.th} fixed>
            <Text style={[s.thText, s.colNo]}>No.</Text>
            <Text style={[s.thText, s.colClient]}>Client</Text>
            <Text style={[s.thText, s.colSuburb]}>Suburb</Text>
            <Text style={[s.thText, s.colInvDate]}>Invoice date</Text>
            <Text style={[s.thText, s.colService]}>Service date</Text>
            <Text style={[s.thText, s.colDue]}>Due date</Text>
            <Text style={[s.thText, s.colTotal]}>Total</Text>
            <Text style={[s.thText, s.colStatus]}>Status</Text>
          </View>

          {statement.rows.length === 0 && (
            <Text style={[s.muted, { paddingVertical: 16 }]}>
              No invoices were issued under this ABN in {statement.fyLabel}.
            </Text>
          )}

          {statement.rows.map((r) => {
            const isCancelled = r.status === "cancelled";
            const tone = isCancelled ? s.cancelled : undefined;
            return (
              <View key={r.invoice_number} style={s.tr} wrap={false}>
                <Text style={[s.colNo, ...(tone ? [tone] : [])]}>
                  {r.invoice_number}
                </Text>
                <Text style={[s.colClient, ...(tone ? [tone] : [])]}>
                  {r.bill_to_name}
                </Text>
                <Text style={[s.colSuburb, s.muted]}>
                  {r.bill_to_suburb ?? ""}
                </Text>
                <Text style={[s.colInvDate, s.muted]}>
                  {formatDate(r.invoice_date)}
                </Text>
                <Text style={[s.colService, s.muted]}>
                  {formatDate(r.service_date)}
                  {r.extraServiceDates > 0 ? ` (+${r.extraServiceDates})` : ""}
                </Text>
                <Text style={[s.colDue, s.muted]}>
                  {formatDate(r.due_date)}
                </Text>
                {/* Cancelled invoices carry no value into the total. */}
                <Text style={[s.colTotal, ...(tone ? [tone] : [])]}>
                  {isCancelled ? "-" : money(r.total)}
                </Text>
                <Text style={[s.colStatus, s.muted]}>{r.status}</Text>
              </View>
            );
          })}
        </View>

        <View style={s.totalRow}>
          <Text style={s.totalLabel}>TOTAL BILLED {statement.fyLabel}</Text>
          <Text style={s.totalValue}>{money(statement.total)}</Text>
        </View>

        {statement.cancelledCount > 0 && (
          <Text style={s.note}>
            {statement.cancelledCount}{" "}
            {statement.cancelledCount === 1
              ? "cancelled invoice is"
              : "cancelled invoices are"}{" "}
            listed above to explain the gap in the invoice numbering, and are
            excluded from the total.
          </Text>
        )}

        {/* What this ABN claims against the year. It is on the same document as
            the income on purpose: the accountant is being asked one question,
            not two, and two attachments is how one of them gets lost. */}
        {statement.deductions.length > 0 && (
          <>
            <Text style={s.sectionTitle}>Expenses to claim</Text>
            <View style={s.table}>
              <View style={s.th}>
                <Text style={[s.thText, s.colDay]}>Date</Text>
                <Text style={[s.thText, s.colWhat]}>What</Text>
                <Text style={[s.thText, s.colKind]}>Kind</Text>
                <Text style={[s.thText, s.colTotal]}>Amount</Text>
              </View>
              {statement.deductions.map((d) => (
                <View key={d.id} style={s.tr} wrap={false}>
                  <Text style={s.colDay}>{formatDate(d.spent_on)}</Text>
                  <Text style={s.colWhat}>
                    {d.description}
                    {d.note ? ` (${d.note})` : ""}
                  </Text>
                  <Text style={[s.colKind, s.muted]}>
                    {deductionLabel(d.category)}
                  </Text>
                  <Text style={s.colTotal}>{money(d.amount)}</Text>
                </View>
              ))}
            </View>

            <View style={s.totalRow}>
              <Text style={s.totalLabel}>TOTAL EXPENSES {statement.fyLabel}</Text>
              <Text style={s.totalValue}>{money(statement.deducted)}</Text>
            </View>

            <Text style={s.note}>
              Recorded by the business against this {taxIdLabel} for this
              financial year, with the date each amount was spent. What is
              claimable is the accountant&apos;s call, not this document&apos;s.
            </Text>
          </>
        )}

        <PageNumber />
      </Page>
    </Document>
  );
}
