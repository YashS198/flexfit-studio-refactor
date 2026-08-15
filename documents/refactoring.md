<!-- 1. Overview
The objective of the refactoring work was to improve code structure, reduce duplication, remove dead code, and separate reusable business logic from tRPC routers while preserving the existing application behavior and UI.
The refactoring was performed incrementally, with each change kept focused and verified using TypeScript compilation, production builds, and manual workflow checks where applicable.
2. Initial Codebase Findings
The source tree contained 41 source files and approximately 5,443 lines across TypeScript and TSX files.
The server router directory contained approximately 2,529 lines across 13 router files. The largest routers were:
•	bookings.ts — 402 lines
•	reschedules.ts — 359 lines
•	corporate-bookings.ts — 322 lines
•	admin.ts — 268 lines
•	admin-companies.ts — 225 lines
•	trainers.ts — 211 lines
The initial investigation focused on finding duplicated logic, dead code, large coherent business-logic blocks, and places where shared validation could diverge.

3. Refactor 1 — Extract shared hoursUntil()
Problem:
The same hoursUntil() function was independently defined in bookings.ts, reschedules.ts, and corporate-bookings.ts.
The implementations were identical:
function hoursUntil(iso: string, now = new Date()): number {
  return (new Date(iso).getTime() - now.getTime()) / 36e5;
}
Change:
Created src/lib/time.ts and moved the shared implementation there.
The three routers now import hoursUntil from the shared utility.
Reason:
- Removes duplicated logic.
- Creates one source of truth.
- Keeps behavior identical.
- Does not change business rules.
Verification:
TypeScript compilation and the production build were run after the change.
4. Refactor 2 — Remove unused activeMembershipFor()
Problem:
reschedules.ts contained an activeMembershipFor() helper that was never called.
A repository-wide search confirmed:
- bookings.ts contained the actual definition and one call site.
- reschedules.ts contained a second definition with no call site.
The rescheduling code instead retrieves membership information directly using the membership ID stored on the original booking.
Change:
Removed the unused activeMembershipFor() helper from src/server/routers/reschedules.ts.
Reason:
Keeping unreachable code makes the codebase harder to understand and creates uncertainty about whether the function is still required.
The helper was removed rather than extracted because there was only one actual caller in the entire codebase.
Behavior impact:
None. The deleted helper was never executed by the rescheduling router.
5. Refactor 3 — Extract booking waitlist promotion
Problem:
bookings.ts contained a large block inside cancel() responsible for promoting the next waitlisted member after a confirmed booking was cancelled.
The block:
1. Found the oldest waitlisted booking.
2. Promoted it to booked.
3. Assigned the class credit cost.
4. Retrieved the member's membership.
5. Deducted credits.
6. Preserved unlimited-credit memberships.
This made cancel() responsible for both cancellation and waitlist-management logic.
Changes:
Created:
- src/domain/bookings/constants.ts
- src/domain/bookings/waitlist.ts
Moved UNLIMITED_CREDITS into domain/bookings/constants.ts.
Extracted the waitlist operation into promoteNextWaitlisted(db, classId, creditCost).
bookings.ts now delegates the operation to the extracted domain function.
Behavior preserved:
- FIFO waitlist ordering using bookedAt.
- Waitlisted to booked status transition.
- Credit assignment.
- Membership lookup.
- Unlimited-credit handling.
- Credit deduction.
- Existing Math.max(0, ...) protection.
The corporate booking waitlist logic was intentionally not merged with this helper because corporate bookings use company credit-pool accounting and therefore represent a different business workflow.
6. Refactor 4 — Extract shared reschedule validation
Problem:
reschedules.ts contained substantial duplicated validation between reschedule() and validateReschedule().
The duplicated validation sequence included:
1. Finding the original booking.
2. Verifying ownership.
3. Verifying that the booking was active.
4. Verifying the reschedule timing rule.
5. Finding the target class.
6. Checking that the target class has the same name.
7. Checking that the target is not the original class.
8. Checking that the target class has not started.
9. Checking that the target class is not cancelled.
10. Checking for an existing active booking.
11. Checking target-class capacity.
Duplicating these checks creates a correctness risk because the two procedures could diverge if one is changed without updating the other.
Changes:
Created:
- src/domain/reschedules/constants.ts
- src/domain/reschedules/validate-reschedule-request.ts
Moved FREE_RESCHEDULE_HOURS into the new constants file.
Extracted the shared validation sequence into validateRescheduleRequest().
The helper returns a discriminated result containing either a validation failure with code and reason, or a successful result containing the original booking, original class, target class, and target capacity status.
Important design decision:
The existing error-handling behavior was preserved.
reschedule() still converts validation failures into TRPCError.
validateReschedule() still returns { valid: false, reason }.
Only the duplicated validation logic was centralized; the external behavior of the two procedures was not merged or changed.
Reason:
This creates one source of truth for rescheduling rules and reduces the risk of future divergence.
7. Verification and Git workflow
The following checks were used during the refactoring:
npx tsc --noEmit
rm -rf .next
pnpm build
The TypeScript compiler and production build completed successfully during the refactoring process.
The changes were committed incrementally and pushed to the refactoring repository.
Refactor commits completed:
1. refactor: extract shared hoursUntil into lib/time
2. refactor: remove unused membership helper
3. refactor: extract waitlist promotion into domain/bookings/waitlist.ts
4. refactor: extract shared reschedule validation
The working repository was kept separate from the original repository and changes were pushed to the user's refactoring repository.
8. Schedule issue discovered
During testing, the schedule page was observed making repeated classes.list requests.
The schedule page currently passes a freshly generated timestamp to the query:
trpc.classes.list.useQuery({
  from: new Date().toISOString(),
});
Development logs showed repeated requests with timestamps changing every few seconds.
This can cause the schedule query input to continually change and may contribute to repeated loading or unstable schedule behavior.
Decision:
This was not changed as part of the refactoring assignment because it is a separate behavioral bug rather than a structural refactoring. Fixing it would be handled as a separate bug-fix commit if required.
9. Reschedule modal issue discovered
During manual testing, the reschedule modal displayed that no other classes were available for rescheduling.
The modal also retrieves classes using a query with a freshly generated timestamp:
trpc.classes.list.useQuery({
  from: new Date().toISOString(),
});
It then filters the result by the original class name.
This issue appears related to the schedule/query behavior and was not changed during the refactoring work.
Decision:
Left unchanged to keep the refactoring scope behavior-preserving.
10. Other issues and observations
Unused membership variable:
The reschedule mutation contains a membership lookup whose result is not subsequently used. This existed before Refactor 4 and was deliberately left untouched because removing it was outside the scope of the shared-validation extraction.
Corporate booking workflow:
Corporate bookings have their own waitlist-promotion logic. It was not merged with the member waitlist helper because corporate bookings use company credit-pool accounting rather than individual membership credits.
Corporate check-in inconsistency:
The corporate booking check-in path inserts a check-in with bookingId set to null, while the normal member booking check-in path stores the booking ID. This creates an inconsistency between the two check-in workflows and should be investigated separately.


ISSUES

1. Schedule issue discovered
During testing, the schedule page was observed making repeated classes.list requests.
The schedule page currently passes a freshly generated timestamp to the query:
trpc.classes.list.useQuery({
  from: new Date().toISOString(),
});
Development logs showed repeated requests with timestamps changing every few seconds.
This can cause the schedule query input to continually change and may contribute to repeated loading or unstable schedule behavior.
Decision:
This was not changed as part of the refactoring assignment because it is a separate behavioral bug rather than a structural refactoring. Fixing it would be handled as a separate bug-fix commit if required.


2.Reschedule modal issue discovered
During manual testing, the reschedule modal displayed that no other classes were available for rescheduling.
The modal also retrieves classes using a query with a freshly generated timestamp:
trpc.classes.list.useQuery({
  from: new Date().toISOString(),
});
It then filters the result by the original class name.
This issue appears related to the schedule/query behavior and was not changed during the refactoring work.
Decision:
Left unchanged to keep the refactoring scope behavior-preserving.


3. Other issues and observations
Unused membership variable:
The reschedule mutation contains a membership lookup whose result is not subsequently used. This existed before Refactor 4 and was deliberately left untouched because removing it was outside the scope of the shared-validation extraction.
Corporate booking workflow:
Corporate bookings have their own waitlist-promotion logic. It was not merged with the member waitlist helper because corporate bookings use company credit-pool accounting rather than individual membership credits.
Corporate check-in inconsistency:
The corporate booking check-in path inserts a check-in with bookingId set to null, while the normal member booking check-in path stores the booking ID. This creates an inconsistency between the two check-in workflows and should be investigated separately.











 -->
