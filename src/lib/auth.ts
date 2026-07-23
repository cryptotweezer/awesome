/**
 * Access whitelist. Only these emails may sign in (internal tool for 2 people).
 * Enforced server-side: in the OAuth callback and in middleware. Never rely on
 * the client for this.
 */
export function getAllowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedEmail(email?: string | null): boolean {
  if (!email) return false;
  return getAllowedEmails().includes(email.toLowerCase());
}

/**
 * Maps the logged-in email to the issuer name used as the internal `created_by`
 * signature on manually created invoices.
 */
const EMAIL_TO_ISSUER: Record<string, string> = {
  "cryptotweezer@gmail.com": "Andres",
  "mavi.sofan33@gmail.com": "Mavi",
};

export function issuerNameFromEmail(email?: string | null): string {
  if (!email) return "Dashboard";
  return EMAIL_TO_ISSUER[email.toLowerCase()] ?? email;
}
