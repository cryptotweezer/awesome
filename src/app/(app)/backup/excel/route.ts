import {
  createBackupWorkbook,
  XLSX_CONTENT_TYPE,
} from "@/lib/data/backup-excel";
import { getCurrentOrg } from "@/lib/data/org";

/**
 * Human-readable backup: one Excel workbook, a sheet per table. This is for
 * eyeballing in a spreadsheet, not for restoring (the JSON download is the
 * complete, restorable copy). Behind the dashboard session; the agent gets the
 * same workbook through `create_backup`, which builds it from the same place.
 *
 *   GET /backup/excel  -> awesome-backup-YYYY-MM-DD.xlsx
 */
export async function GET() {
  const session = await getCurrentOrg();
  if (!session) return new Response("Not found", { status: 404 });

  const wb = await createBackupWorkbook(session.org.id);

  return new Response(new Uint8Array(wb.buffer), {
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${wb.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
