"use server";

import { getCurrentOrg, updateOrgOnboarding } from "@/lib/data/org";
import { tourKey } from "./tour-key";

/**
 * Remember that THIS PERSON has seen the tour.
 *
 * Kept on the organisation rather than in the browser, so it does not come back
 * on another machine, and so somebody who signs in from their phone a week
 * later is not walked through the app again. Recorded per user id inside the
 * same `onboarding` object: the tour explains the app to a person, so the
 * second person to join a business still gets it, and one browser used by two
 * accounts does not swallow it for the second one.
 *
 * Before the business exists there is nowhere to write it, and the answer is
 * simply "not yet": the browser holds it until then, and the component sends it
 * here the moment there is an organisation to attach it to.
 */
export async function finishTourAction(): Promise<void> {
  const ctx = await getCurrentOrg();
  if (!ctx) return;
  await updateOrgOnboarding(ctx.org.id, {
    [tourKey(ctx.member.user_id)]: true,
  });
}
