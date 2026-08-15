import { and, asc, eq } from "drizzle-orm";
import { bookings, memberships } from "@/db/schema";
import { UNLIMITED_CREDITS } from "./constants";

export async function promoteNextWaitlisted(
  db: typeof import("@/db").db,
  classId: number,
  creditCost: number,
): Promise<void> {
  const next = await db
    .select()
    .from(bookings)
    .where(
      and(eq(bookings.classId, classId), eq(bookings.status, "waitlisted")),
    )
    .orderBy(asc(bookings.bookedAt))
    .get();

  if (next) {
    await db
      .update(bookings)
      .set({ status: "booked", creditsUsed: creditCost })
      .where(eq(bookings.id, next.id));

    if (next.membershipId) {
      const ms = await db
        .select()
        .from(memberships)
        .where(eq(memberships.id, next.membershipId))
        .get();

      if (ms && ms.creditsRemaining < UNLIMITED_CREDITS) {
        await db
          .update(memberships)
          .set({
            creditsRemaining: Math.max(
              0,
              ms.creditsRemaining - creditCost,
            ),
          })
          .where(eq(memberships.id, ms.id));
      }
    }
  }
}
