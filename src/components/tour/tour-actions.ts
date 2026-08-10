"use server";

import { getCurrentOrg, updateOrgOnboarding } from "@/lib/data/org";

/**
 * Remember that this business has seen the tour.
 *
 * Kept on the organisation rather than in the browser, so it does not come back
 * on another machine, and so somebody who signs in from their phone a week
 * later is not walked through the app again.
 *
 * Before the business exists there is nowhere to write it, and the answer is
 * simply "not yet": the browser holds it until then, and the component sends it
 * here the moment there is an organisation to attach it to.
 */
export async function finishTourAction(): Promise<void> {
  const ctx = await getCurrentOrg();
  if (!ctx) return;
  await updateOrgOnboarding(ctx.org.id, { tour_done: true });
}
