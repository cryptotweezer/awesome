import "server-only";
import ExcelJS from "exceljs";
import { createBackup } from "@/lib/data/backup";

/**
 * The same backup, as a spreadsheet.
 *
 * The JSON backup is the complete, restorable copy; this one is the readable
 * one, and it is the format a business owner actually asks for, because it is
 * the format they forward to their accountant. Both the dashboard button and
 * the agent's `create_backup` render through here, so there is one workbook and
 * not two that drift apart.
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

export type BackupWorkbook = {
  filename: string;
  buffer: Uint8Array;
  /** Same counts the JSON backup reports, so a caller can say what it got. */
  counts: Record<string, number>;
  generated_at: string;
};

export async function createBackupWorkbook(
  orgId: string,
): Promise<BackupWorkbook> {
  const backup = await createBackup(orgId);

  const wb = new ExcelJS.Workbook();
  wb.creator = "awesome-billing";
  wb.created = new Date();
  addSheet(wb, "Invoices", backup.invoices as Row[]);
  addSheet(wb, "Line Items", backup.invoice_items as Row[]);
  addSheet(wb, "Clients", backup.clients as Row[]);
  addSheet(wb, "ABNs", backup.issuers as Row[]);
  addSheet(wb, "Business", [backup.org as Row]);

  const buffer = await wb.xlsx.writeBuffer();
  return {
    filename: `awesome-backup-${backup.meta.date}.xlsx`,
    buffer: new Uint8Array(buffer as ArrayBuffer),
    counts: backup.counts,
    generated_at: backup.meta.generated_at,
  };
}

export const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
