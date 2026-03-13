# Admin Management Feature

## Purpose

- Provide admin-only read/write APIs for leagues, session templates, session occurrences, slot assignments, players, rosters, and manual attendance/sub controls.

## Core API

- `adminLeagues` / `adminLeagueDetail` / `adminLeagueRules`
- `adminPlayers` / `adminOccurrenceRoster`
- `adminCreateLeague` / `adminUpdateLeague` / `adminDeleteLeague`
- `adminCreateSession` / `adminUpdateSession` / `adminDeleteSession`
- `adminCreateSessionOccurrence` / `adminCreateSessionOccurrences` / `adminUpdateSessionOccurrence` / `adminDeleteSessionOccurrence`
- `adminCreateSlotAssignment` / `adminCreateSlotAssignments` / `adminUpdateSlotAssignment` / `adminDeleteSlotAssignment`
- `adminCreatePlayer` / `adminUpdatePlayer`
- `adminSetRegistration` / `adminSetSubSignup`
- `adminUpsertLeagueRule` / `adminCopyLeagueRulesFromTemplate`
- All admin mutations require the authenticated user role to be `ADMIN`.
- All admin read queries above require the authenticated user role to be `ADMIN`.

## Key Files

- src/features/admin/adminManagementService.ts: Admin CRUD business logic and delete semantics.
- src/app/graphql/schema.ts: Admin GraphQL input/types and mutation resolvers.
- src/app/auth.ts: `requireAdmin` auth guard.
- src/shared/phone.ts: E.164 phone normalization used for auth and admin assignment.
- prisma/schema.prisma: League/session lifecycle enums and placeholder-user tracking field.

## Data Flow

- League lifecycle uses `LeagueStatus` (`DRAFT`, `UPCOMING`, `ACTIVE`, `ARCHIVED`) and enforces one `ACTIVE` league at a time.
- Session lifecycle uses `SessionStatus` (`ACTIVE`, `ARCHIVED`).
- Admin league and player list queries support pagination (`limit`/`offset`), with player filters for `search`, `role`, and `isOnApp`.
- League delete hard-cascades dependent sessions, occurrences, assignments, registrations, sub signups, notifications, and rules.
- Session delete archives when historical participation exists; otherwise hard-deletes related empty data.
- Occurrence create/update validates that every occurrence stays within its parent league date bounds.
- Occurrence delete auto-cancels when participation exists; otherwise hard-deletes.
- Slot assignment accepts phone numbers, normalizes to E.164, and upserts placeholder users (`isOnApp = false`) when needed.
- Admin direct registration/sub status mutations upsert rows for explicit roster control.
