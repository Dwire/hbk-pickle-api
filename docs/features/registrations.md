# Registration Feature

## Purpose

- Allow assigned players to confirm weekly attendance and cancel per occurrence.

## Core API

- Register for session occurrence (attendance).
- Cancel registration for an occurrence.

## Key Files

- src/features/registrations/registrationService.ts: Occurrence-based attendance registration logic.
- src/app/graphql/schema.ts: Registration mutations (occurrence-scoped).

## Data Flow

- Upsert registration record per occurrence with ATTENDING or CANCELED.
- Registration attempts are rejected when the target occurrence status is `CANCELED`.
