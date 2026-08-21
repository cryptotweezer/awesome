/**
 * The name the MCP server gets in the person's own config. Lowercase and with
 * no spaces, because it is typed on a command line, and named after their
 * business so that somebody connected to two of these can tell them apart.
 *
 * It lives in a file of its own, with no "use client", because both a server
 * page and a client component call it. Exported from the client component it
 * became a client reference, and calling one of those on the server is a 500,
 * not a type error: the guide and the Agents page both went down.
 */
export function serverName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "billing"
  );
}
