# Demo Org Autofill

## Purpose

- Auto-populate demo-org active-league session occurrences during the open registration window.
- Keep demo sessions partially open by combining assigned-player registration autofill with controlled sub autofill.

## Core API

- Scheduler tick executes demo-org autofill once per tick.
- Registration autofill runs only when an occurrence currently has zero `ATTENDING` registrations.
- Registration autofill target is randomized per eligible occurrence between 50% and 80% of session capacity.
- Sub autofill adds at most one sub signup per occurrence per tick.
- Sub autofill caps each occurrence at 8 sub signups counted as `ACTIVE` + `SELECTED`.

## Key Files

- src/jobs/schedulers/demoOrgAutofillService.ts: Demo-org scoped registration/sub autofill orchestration.
- src/jobs/schedulers/registrationScheduler.ts: Scheduler orchestration entrypoint for demo-org autofill.
- src/jobs/schedulers/runRegistrationTick.ts: Shared tick flow that invokes demo-org autofill before sub-selection queueing.

## Data Flow

- Autofill scope is constrained to `Organization.slug = demo-org`, `League.status = ACTIVE`, `Session.status = ACTIVE`, and `SessionOccurrence.status = ACTIVE`.
- Occurrence loading is bounded to the next Eastern day so scheduler-tick query cost remains fixed over time.
- Autofill only processes occurrences where current time is inside the registration window (`registrationOpenAt <= now <= registrationCloseAt`).
- Registration autofill uses slot assignments for the target session ordered by `slotAssignment.createdAt` then `userId`, but only where `user.isOnApp = false`.
- Registration writes use existing `RegistrationService.register(...)` logic to preserve validation and window checks.
- Registration/sub attempt failures are counted and logged at debug level with `occurrenceId` and `userId` context for diagnostics.
- Sub candidate pool uses active league members not assigned to the target session, ordered by `leagueMembership.createdAt` then `userId`, and only includes users where `user.isOnApp = false`.
- Sub candidates are filtered out when they already have same-day `ATTENDING` registration or another same-day `ACTIVE`/`SELECTED` sub signup.
- Sub writes use existing `SubSignupService.signup(...)` logic so normal eligibility checks remain authoritative.
