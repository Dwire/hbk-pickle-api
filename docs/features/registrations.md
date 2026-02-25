# Registration Feature

## Purpose

- Allow assigned players to confirm attendance and cancel.

## Core API

- Register for session (attendance).
- Cancel registration.

## Key Files

- src/features/registrations/registrationService.ts: Attendance registration logic.
- src/app/graphql/schema.ts: Registration mutations.

## Data Flow

- Upsert registration record with ATTENDING or CANCELED.
