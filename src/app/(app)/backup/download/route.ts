import { createBackup } from "@/lib/data/backup";
import { getCurrentOrg } from "@/lib/data/org";

/**
 * Streams a full JSON backup of the signed-in user's own business. Nothing is
 * stored server side; the file lives wherever the user saves it.
 *
 *   GET /backup/download  -> awesome-backup-YYYY-MM-DD.json
 */
export async function GET() {
  const session = await getCurrentOrg();
  if (!session) return new Response("Not found", { status: 404 });

  const backup = await createBackup(session.org.id);
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
