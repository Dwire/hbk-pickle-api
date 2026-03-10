# Sub Signup Feature

## Purpose

- Allow players to offer as substitutes for weekly occurrences, including those assigned to the session.
- Keep sub signup availability open until the session occurrence ends (Eastern rules applied to UTC instants).

## Core API

- Signup as sub for a session occurrence.
- Cancel sub signup for an occurrence.

## Key Files

- src/features/subs/subSignupService.ts: Occurrence-based sub signup logic.
- src/app/graphql/schema.ts: Sub signup mutations (occurrence-scoped).

## Data Flow

- Upsert sub signup record per occurrence with ACTIVE or CANCELED.
- Enforce sub signup window using SessionService.isWithinSubSignupWindow(now, occurrence.endsAt).
- Allow sub signups regardless of assignment; enforce same-day attendance and same-day sub constraints.
- Session summaries count only ACTIVE sub signups; canceled/selected/replaced do not contribute to subCount.
