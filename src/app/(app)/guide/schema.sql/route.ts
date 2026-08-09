import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The installer: the complete database this app needs, as one file to paste
 * into a fresh Supabase project.
 *
 * It is served from the repo rather than generated, so what somebody installs
 * is exactly what is under version control. Kept in the serverless trace by
 * `outputFileTracingIncludes` in next.config.ts.
 *
 *   GET /guide/schema.sql
 */
export async function GET() {
  const file = path.join(process.cwd(), "supabase", "schema.sql");
  let sql: string;
  try {
    sql = await readFile(file, "utf8");
  } catch {
    return new Response("The schema file is not available in this build.", {
      status: 404,
    });
  }

  return new Response(sql, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": 'attachment; filename="schema.sql"',
      "Cache-Control": "no-store",
    },
  });
}
