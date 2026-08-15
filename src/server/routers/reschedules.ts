import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { desc, eq, sql } from "drizzle-orm";
import {
  reschedules,
  bookings,
  classes,
  memberships,
} from "@/db/schema";
import { router, protectedProcedure } from "../trpc";
import { validateRescheduleRequest } from "@/domain/reschedules/validate-reschedule-request";

export const reschedulesRouter = router({
  reschedule: protectedProcedure
    .input(
      z.object({
        fromBookingId: z.number(),
        toClassId: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await validateRescheduleRequest(
        ctx.db,
        ctx.user.id,
        input.fromBookingId,
        input.toClassId,
      );

      if (!result.valid) {
        throw new TRPCError({ code: result.code, message: result.reason });
      }

      const { originalBooking, originalClass, targetClass, targetIsFull } = result;

      // Get the membership to check for unlimited credits
      const membership = originalBooking.membershipId
        ? await ctx.db
            .select()
            .from(memberships)
            .where(eq(memberships.id, originalBooking.membershipId))
            .get()
        : null;

      // Create the new booking (don't charge credits, they keep what they spent)
      const newBooking = await ctx.db
        .insert(bookings)
        .values({
          classId: targetClass.id,
          userId: ctx.user.id,
          membershipId: originalBooking.membershipId,
          status: targetIsFull ? "waitlisted" : "booked",
          creditsUsed: originalBooking.creditsUsed, // Keep the same credits used
        })
        .returning()
        .get();

      // Cancel the original booking
      await ctx.db
        .update(bookings)
        .set({
          status: "cancelled",
          cancelledAt: new Date().toISOString(),
        })
        .where(eq(bookings.id, originalBooking.id));

      // Record the reschedule
      await ctx.db.insert(reschedules).values({
        userId: ctx.user.id,
        fromBookingId: originalBooking.id,
        toBookingId: newBooking.id,
        fromClassId: originalClass.id,
        toClassId: targetClass.id,
      });

      return {
        ok: true,
        newBooking,
        newStatus: targetIsFull ? "waitlisted" : "booked",
      };
    }),

  history: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: reschedules.id,
        rescheduledAt: reschedules.rescheduledAt,
        fromClassName: classes.name,
        fromClassTime: sql<string>`(
          SELECT ${classes.startsAt} FROM ${classes}
          WHERE ${classes.id} = ${reschedules.fromClassId}
        )`,
        fromClassRoom: sql<string>`(
          SELECT ${classes.room} FROM ${classes}
          WHERE ${classes.id} = ${reschedules.fromClassId}
        )`,
        toClassName: sql<string>`(
          SELECT ${classes.name} FROM ${classes}
          WHERE ${classes.id} = ${reschedules.toClassId}
        )`,
        toClassTime: sql<string>`(
          SELECT ${classes.startsAt} FROM ${classes}
          WHERE ${classes.id} = ${reschedules.toClassId}
        )`,
        toClassRoom: sql<string>`(
          SELECT ${classes.room} FROM ${classes}
          WHERE ${classes.id} = ${reschedules.toClassId}
        )`,
      })
      .from(reschedules)
      .innerJoin(classes, eq(reschedules.fromClassId, classes.id))
      .where(eq(reschedules.userId, ctx.user.id))
      .orderBy(desc(reschedules.rescheduledAt));
  }),

  validateReschedule: protectedProcedure
    .input(
      z.object({
        fromBookingId: z.number(),
        toClassId: z.number(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const result = await validateRescheduleRequest(
        ctx.db,
        ctx.user.id,
        input.fromBookingId,
        input.toClassId,
      );

      if (!result.valid) {
        return { valid: false, reason: result.reason };
      }

      return {
        valid: true,
        targetIsFull: result.targetIsFull,
      };
    }),
});