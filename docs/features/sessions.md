# Sessions Feature

## Purpose

- Manage recurring session templates and weekly occurrences.

## Core API

- List session occurrences for the current Eastern week via `sessionsWeek(leagueId)` with optional `leagueId`, including next Monday rows starting Sunday 8:00am ET for countdown visibility.
- Session summaries include user-specific registration/sub signup status when authenticated.
- Session summaries expose `occurrenceStatus` (`ACTIVE`/`CANCELED`) so clients can render canceled sessions differently.
- Admin create/update/archive session templates and create/update/delete occurrences.
- Admin occurrence create/update enforces parent league date bounds (`startsAt >= league.startDate`, `endsAt <= league.endDate` when bounds exist).
- Admin league detail nested session rows expose occurrence counters (`attendingCount`, `subCount`, `openSpots`) and filtered occurrence lists for dashboard rendering.
- Occurrence delete auto-cancels when historical registration/sub data exists.

## Key Files

- src/features/sessions/sessionService.ts: Week listing, occurrence detail, counters, and notification queueing.
- src/app/graphql/schema.ts: Session queries and admin mutations (templates + occurrences).
- src/shared/constants.ts: Registration window timing.

## Data Flow

- Occurrences are the dated instances used for registration and sub availability.
- Occurrences have `ACTIVE`/`CANCELED` status; new occurrences default to `ACTIVE`.
- Session templates have `ACTIVE`/`ARCHIVED` status.
- Registration windows open 10am ET the day before and close at 7pm ET the day before (computed from UTC instants).
- Sub signups stay open until the session ends (Eastern rules applied to UTC instants).
- Assignments gate registration eligibility, while sub signups remain assignment-agnostic.
- `sessionOccurrenceDetail` capability flags (`canRegister`, `canSub`) require active league membership so UI actions match mutation enforcement.
- Session display state (PAST/LIVE/UPCOMING) compares Eastern wall-clock projections of UTC instants so sessions only go PAST after the listed end time.
- `sessionsWeek` resolves league scope from explicit `leagueId` or from the caller's effective active league context and enforces league access.
- `sessionsWeek` uses Monday-Sunday as the canonical Eastern week but pre-shows next Monday sessions at 8:00am ET Sunday (2 hours before registration opens).
- Canceled occurrences remain visible in `sessionsWeek` and include `occurrenceStatus = CANCELED`.
- sessionsWeek sub signup status returns ACTIVE or SELECTED records for the current user (canceled/replaced are excluded).
- Session occurrence summaries report subCount using ACTIVE + SELECTED sub signups (canceled/replaced excluded).
- Session occurrence summaries report attendingCount using ATTENDING registrations only (canceled/declined excluded).
- Session occurrence summaries include `registeredUsers` and `subUsers` participant lists (`id`, `displayName`, `profileImageUrl`) for ATTENDING and ACTIVE/SELECTED sub signup states respectively.
- Sub participant lists and session detail `subs` are ordered by sub queue signup time (`signedUpAt` ascending).
