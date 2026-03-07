# Sessions Feature

## Purpose

- Manage recurring session templates and weekly occurrences.

## Core API

- List session occurrences for the current Eastern week (with registration window details).
- Session summaries include user-specific registration/sub signup status when authenticated.
- Admin create session templates and weekly occurrences.
- Admin assign players to recurring session slots.

## Key Files

- src/features/sessions/sessionService.ts: Session templates, occurrence listing, and occurrence creation.
- src/app/graphql/schema.ts: Session queries and admin mutations (templates + occurrences).
- src/shared/constants.ts: Registration window timing.

## Data Flow

- Occurrences are the dated instances used for registration and sub availability.
- Registration windows open 10am ET the day before and close at 7pm ET the day before.
- Sub signups stay open until the session ends (PAST state) in Eastern time.
- Session display state (PAST/LIVE/UPCOMING) compares current Eastern time against the stored session end time (treated as Eastern wall-clock) so sessions only go PAST after the listed end time.
- Session templates are tied to the default league and referenced by assignments.
- sessionsWeek sub signup status returns only ACTIVE records for the current user (canceled/selected/replaced are excluded).
- Session occurrence summaries report subCount using ACTIVE sub signups only (canceled/selected/replaced excluded).
