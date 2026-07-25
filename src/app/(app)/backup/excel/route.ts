import ExcelJS from "exceljs";
import { createBackup } from "@/lib/data/backup";

/**
 * Human-readable backup: one Excel workbook, a sheet per table. This is for
 * eyeballing in a spreadsheet, not for restoring (the JSON download is the
 * complete, restorable copy). Manual download only, behind the dashboard
 * session, and never exposed as an agent tool.
 *
 *   GET /backup/excel  -> awesome-backup-YYYY-MM-DD.xlsx
 */
type Row = Record<string, unknown>;

function coerce(v: unknown): unknown {
  // Supabase returns numeric columns as strings; make them real numbers so the
  // spreadsheet can sum and sort them.
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

function addSheet(wb: ExcelJS.Workbook, name: string, rows: Row[]) {
  const ws = wb.addWorksheet(name);
  if (rows.length === 0) return;
  const cols = Object.keys(rows[0]);
  ws.columns = cols.map((c) => ({
    header: c,
    key: c,
    width: Math.min(Math.max(c.length + 2, 12), 40),
  }));
  for (const r of rows) {
    const out: Row = {};
    for (const c of cols) out[c] = coerce(r[c]);
    ws.addRow(out);
  }
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

export async function GET() {
  const backup = await createBackup();

  const wb = new ExcelJS.Workbook();
  wb.creator = "awesome-billing";
  wb.created = new Date();
  addSheet(wb, "Invoices", backup.invoices as Row[]);
  addSheet(wb, "Line Items", backup.invoice_items as Row[]);
  addSheet(wb, "Clients", backup.clients as Row[]);
  addSheet(wb, "ABNs", backup.issuers as Row[]);
  addSheet(wb, "Company", backup.company_profile as Row[]);

  const buffer = await wb.xlsx.writeBuffer();
  const filename = `awesome-backup-${backup.meta.date}.xlsx`;

  return new Response(new Uint8Array(buffer as ArrayBuffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
