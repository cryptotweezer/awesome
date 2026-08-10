import { redirect } from "next/navigation";

/**
 * Kept only so old links and bookmarks land somewhere sensible.
 *
 * Signing up used to happen here, on a screen of its own, before anybody had
 * seen what they were signing up to. The form now lives in Business details,
 * which is where it lives for the rest of the account's life, and the dashboard
 * tour leads there. Somebody who already has a business simply lands on their
 * own settings page.
 */
export default function OnboardingPage() {
  redirect("/settings");
}
