/**
 * Where a person's "I have seen the tour" is kept inside `orgs.onboarding`.
 *
 * Its own module because a `"use server"` file may only export async functions,
 * and both the layout (reading) and the action (writing) need this one string.
 */
export function tourKey(userId: string): string {
  return `tour_done:${userId}`;
}
