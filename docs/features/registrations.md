# Registration Feature

## Purpose

- Allow assigned players to confirm weekly attendance and cancel per occurrence.

## Core API

- Register for session occurrence (attendance).
- Cancel registration for an occurrence.
- Set registration play preference (`FULL` or edge-aligned `PARTIAL` in 15-minute blocks).

## Key Files

- src/features/registrations/registrationService.ts: Occurrence-based attendance registration logic.
- src/app/graphql/schema.ts: Registration mutations (occurrence-scoped).

## Data Flow

- Upsert registration record per occurrence with ATTENDING or CANCELED.
- Require `LeagueMembership.status = ACTIVE` for the occurrence league.
- Registration attempts are rejected when the target occurrence status is `CANCELED`.
- At or after registration close, registration updates can keep or reduce effective playtime but cannot increase it.
- Post-close playtime extension attempts fail with GraphQL `BAD_USER_INPUT` and reason `REGISTRATION_WINDOW_CLOSED_EXTENSION_NOT_ALLOWED`.
- `fillTargetRegistrationId` is retained in the API shape for compatibility but ignored server-side by selection logic.
