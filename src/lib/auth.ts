/**
 * Who may sign in.
 *
 * Two modes, and the app ships in the closed one:
 *
 *   GUEST_SIGNUP unset or "false"  ->  only ALLOWED_EMAILS get in. This is how
 *                                      the app has always worked, and how it
 *                                      stays until the guest experience is
 *                                      finished and reviewed.
 *   GUEST_SIGNUP = "true"          ->  anyone with a Google account gets in and
 *                                      is sent to /onboarding to create their
 *                                      own business.
 *
 * Opening registration is therefore an environment-variable change and not a
 * deploy, which means the code can land long before anybody can walk in.
 *
 * Enforced server-side: in the OAuth callback and in the proxy. Never rely on
 * the client for this.
 */
export function isGuestSignupEnabled(): boolean {
  return (process.env.GUEST_SIGNUP ?? "").toLowerCase() === "true";
}

/** The people who work for the business that owns this deployment. */
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

// The map from email to `created_by` signature used to live here, hardcoded to
// two Gmail addresses. It now comes from org_members.display_name, so every
// organisation signs its own invoices. See signatureFor() in lib/data/org.ts.
