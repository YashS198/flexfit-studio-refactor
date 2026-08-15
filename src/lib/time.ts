/**
 * Hours between now and the given ISO timestamp. Negative if `iso` is in the past.
 *
 * Extracted from bookings.ts / reschedules.ts / corporate-bookings.ts, which each
 * defined an identical copy of this function. Behavior is unchanged.
 */
export function hoursUntil(iso: string, now = new Date()): number {
  return (new Date(iso).getTime() - now.getTime()) / 36e5;
}