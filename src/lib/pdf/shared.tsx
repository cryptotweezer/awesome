import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import type { CompanyProfile } from "@/lib/types";

/**
 * Pieces every printed document shares: the letterhead, the bank-details
 * footer, colours and money formatting. Kept in one place so the invoice and
 * the two statements can never drift apart.
 */

export const INK = "#0f172a";
export const MUTED = "#475569";
export const LINE = "#cbd5e1";
export const DANGER = "#b91c1c";

/** "$120.00" — printed money, distinct from the dashboard's `formatAUD`. */
export function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `$${Number(n).toFixed(2)}`;
}

// Read once per server process. `public/logo_black.png` is kept in the trace
// via `outputFileTracingIncludes` in next.config.ts so this works on Vercel too.
export const logo = readFileSync(
  path.join(process.cwd(), "public", "logo_black.png"),
);

export const base = StyleSheet.create({
  page: {
    paddingTop: 38,
    paddingBottom: 56,
    paddingHorizontal: 44,
    fontSize: 9.5,
    fontFamily: "Helvetica",
    color: INK,
  },

  header: { flexDirection: "row", justifyContent: "space-between" },
  logo: { width: 88, height: 88 },
  issuer: { textAlign: "right", maxWidth: 260 },
  issuerName: { fontFamily: "Helvetica-Bold", fontSize: 11, marginBottom: 3 },
  issuerLine: { color: MUTED, marginBottom: 1.5 },
  abn: { fontFamily: "Helvetica-Bold", color: INK },

  businessName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 19,
    marginTop: 12,
    marginBottom: 18,
  },

  label: { fontFamily: "Helvetica-Bold", fontSize: 9, marginBottom: 4 },
  billToName: { fontFamily: "Helvetica-Bold", marginBottom: 1.5 },
  billToLine: { color: MUTED, marginBottom: 1.5 },

  metaRow: { flexDirection: "row", marginBottom: 3 },
  metaLabel: { width: 76, color: MUTED },
  metaValue: { fontFamily: "Helvetica-Bold", textAlign: "right", width: 80 },

  footer: {
    position: "absolute",
    bottom: 30,
    left: 44,
    right: 44,
    borderTopWidth: 0.5,
    borderTopColor: LINE,
    paddingTop: 8,
    fontSize: 8.5,
    color: MUTED,
    lineHeight: 1.45,
  },
  pageNumber: {
    position: "absolute",
    bottom: 18,
    left: 44,
    right: 44,
    textAlign: "center",
    fontSize: 8,
    color: MUTED,
  },
});

/**
 * Logo + the billing entity's details. `issuerName`/`issuerAbn` come from the
 * invoice snapshot (or the chosen ABN), never from the live issuers table, so
 * a reprint always shows what was billed at the time.
 */
export function LetterHead({
  issuerName,
  issuerAbn,
  company,
}: {
  issuerName: string;
  issuerAbn: string;
  company: CompanyProfile;
}) {
  return (
    <>
      <View style={base.header}>
        {/* react-pdf's Image, not an HTML img — alt text does not apply. */}
        {/* eslint-disable-next-line jsx-a11y/alt-text */}
        <Image style={base.logo} src={{ data: logo, format: "png" }} />
        <View style={base.issuer}>
          <Text style={base.issuerName}>{issuerName}</Text>
          <Text style={base.issuerLine}>{company.address_line}</Text>
          <Text style={base.issuerLine}>
            {company.suburb}, {company.state}, {company.postcode}
          </Text>
          <Text style={base.issuerLine}>E: {company.email}</Text>
          <Text style={base.issuerLine}>M: {company.phone}</Text>
          <Text style={base.issuerLine}>
            ABN: <Text style={base.abn}>{issuerAbn}</Text>
          </Text>
        </View>
      </View>
      <Text style={base.businessName}>{company.business_name}</Text>
    </>
  );
}

/**
 * Letterhead for documents that are NOT issued by one ABN — the client
 * statement spans whichever ABNs their invoices happen to carry, so it shows
 * the business's own contact details instead of an individual issuer's.
 */
export function CompanyLetterHead({ company }: { company: CompanyProfile }) {
  return (
    <>
      <View style={base.header}>
        {/* react-pdf's Image, not an HTML img — alt text does not apply. */}
        {/* eslint-disable-next-line jsx-a11y/alt-text */}
        <Image style={base.logo} src={{ data: logo, format: "png" }} />
        <View style={base.issuer}>
          <Text style={base.issuerLine}>{company.address_line}</Text>
          <Text style={base.issuerLine}>
            {company.suburb}, {company.state}, {company.postcode}
          </Text>
          <Text style={base.issuerLine}>E: {company.email}</Text>
          <Text style={base.issuerLine}>M: {company.phone}</Text>
        </View>
      </View>
      <Text style={base.businessName}>{company.business_name}</Text>
    </>
  );
}

export function PaymentFooter({ company }: { company: CompanyProfile }) {
  return (
    <Text style={base.footer} fixed>
      {company.payment_note}
    </Text>
  );
}

export function PageNumber() {
  return (
    <Text
      style={base.pageNumber}
      fixed
      render={({ pageNumber, totalPages }) =>
        totalPages > 1 ? `Page ${pageNumber} of ${totalPages}` : ""
      }
    />
  );
}

export function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={base.metaRow}>
      <Text style={base.metaLabel}>{label}</Text>
      <Text style={base.metaValue}>{value}</Text>
    </View>
  );
}
