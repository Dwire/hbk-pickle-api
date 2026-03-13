# Profile Stats Feature

## Purpose

- Provide profile page summary stats for the authenticated user scoped to their current league.

## Core API

- Query profileStats to return current league summary, leagues participated, and attendance/sub counts.

## Key Files

- src/features/users/userService.ts: Aggregates profile stats from assignments, registrations, and sub signups.
- src/app/graphql/schema.ts: Adds ProfileStats type and profileStats query.

## Data Flow

- Resolve current league from slot assignments (prefer active league, otherwise most recent assignment).
- Leagues participated list comes from all leagues tied to slot assignments.
- Sub signup count includes non-canceled sub signups for `ACTIVE` occurrences in the current league.
- Sub selected count includes selected sub signups for `ACTIVE` occurrences in the current league.
- Attendance count includes ATTENDING registrations for `ACTIVE` occurrences in the current league.
- Missed count equals total registrations for `ACTIVE` occurrences in the current league minus attendance count.
