import { and, eq, sql } from "drizzle-orm";
import { bookings, classes, type Booking, type GymClass } from "@/db/schema";
import { hoursUntil } from "@/lib/time";
import { FREE_RESCHEDULE_HOURS } from "@/domain/reschedules/constants";

type RescheduleErrorCode = "NOT_FOUND" | "FORBIDDEN" | "BAD_REQUEST" | "CONFLICT";

export type RescheduleValidationResult =
  | { valid: false; code: RescheduleErrorCode; reason: string }
  | {
      valid: true;
      originalBooking: Booking;
      originalClass: GymClass;
      targetClass: GymClass;
      targetIsFull: boolean;
    };

/**
 * Shared validation for reschedule() and validateReschedule(). This runs the
 * identical sequence of checks both procedures previously duplicated.
 *
 * This function only reports what failed and why (via `code` + `reason`) —
 * it does not decide how to surface it. reschedule() throws a TRPCError
 * using `code`/`reason` exactly as it did before extraction.
 * validateReschedule() returns `{ valid: false, reason }` (ignoring `code`)
 * exactly as it did before extraction. Every condition, ordering, and
 * message string below is copied verbatim from the original duplicated
 * blocks — nothing was reworded, reordered, or combined.
 */
export async function validateRescheduleRequest(
  db: typeof import("@/db").db,
  userId: number,
  fromBookingId: number,
  toClassId: number,
): Promise<RescheduleValidationResult> {
  // Get the original booking with its class details
  const originalRow = await db
    .select({
      booking: bookings,
      cls: classes,
    })
    .from(bookings)
    .innerJoin(classes, eq(bookings.classId, classes.id))
    .where(eq(bookings.id, fromBookingId))
    .get();

  if (!originalRow) {
    return { valid: false, code: "NOT_FOUND", reason: "Booking not found." };
  }

  const originalBooking = originalRow.booking;
  const originalClass = originalRow.cls;

  // Verify ownership
  if (originalBooking.userId !== userId) {
    return {
      valid: false,
      code: "FORBIDDEN",
      reason: "You cannot reschedule this booking.",
    };
  }

  // Verify booking is still active
  if (originalBooking.status !== "booked" && originalBooking.status !== "waitlisted") {
    return {
      valid: false,
      code: "BAD_REQUEST",
      reason: "This booking is no longer active.",
    };
  }

  // Verify reschedule is allowed (within 4 hours of original class)
  const hoursBeforeOriginal = hoursUntil(originalClass.startsAt);
  if (hoursBeforeOriginal < FREE_RESCHEDULE_HOURS) {
    return {
      valid: false,
      code: "BAD_REQUEST",
      reason: `You can only reschedule up to ${FREE_RESCHEDULE_HOURS} hours before the class starts.`,
    };
  }

  // Get target class
  const targetClass = await db
    .select()
    .from(classes)
    .where(eq(classes.id, toClassId))
    .get();

  if (!targetClass) {
    return { valid: false, code: "NOT_FOUND", reason: "Target class not found." };
  }

  // Verify target class has the same name
  if (targetClass.name !== originalClass.name) {
    return {
      valid: false,
      code: "BAD_REQUEST",
      reason: "You can only reschedule to a class with the same name.",
    };
  }

  // Verify target class is not the same class
  if (targetClass.id === originalClass.id) {
    return {
      valid: false,
      code: "BAD_REQUEST",
      reason: "You are already booked for this class.",
    };
  }

  // Verify target class hasn't started
  if (hoursUntil(targetClass.startsAt) <= 0) {
    return {
      valid: false,
      code: "BAD_REQUEST",
      reason: "This class has already started.",
    };
  }

  // Verify target class is not cancelled
  if (targetClass.cancelled) {
    return {
      valid: false,
      code: "BAD_REQUEST",
      reason: "This class has been cancelled.",
    };
  }

  // Check if user already has an active booking for this class
  const existingBooking = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.classId, targetClass.id),
        eq(bookings.userId, userId),
        sql`${bookings.status} in ('booked', 'waitlisted')`,
      ),
    )
    .get();

  if (existingBooking) {
    return {
      valid: false,
      code: "CONFLICT",
      reason: "You already have an active booking for this class.",
    };
  }

  // Check if target class is full
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(bookings)
    .where(
      and(eq(bookings.classId, targetClass.id), eq(bookings.status, "booked")),
    );

  const targetIsFull = Number(count) >= targetClass.capacity;

  return {
    valid: true,
    originalBooking,
    originalClass,
    targetClass,
    targetIsFull,
  };
}