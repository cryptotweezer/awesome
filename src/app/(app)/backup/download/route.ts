import { createBackup } from "@/lib/data/backup";

/**
 * Streams a full JSON backup as a download. Behind the dashboard session auth
 * (the proxy), so only a signed-in user can pull it. Nothing is stored server
 * side; the file lives wherever the user saves it.
 *
 *   GET /backup/download  -> awesome-backup-YYYY-MM-DD.json
 */
export async function GET() {
  const backup = await createBackup();
  const json = JSON.stringify(backup, null, 2);
  const filename = `awesome-backup-${backup.meta.date}.json`;

  return new Response(json, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
